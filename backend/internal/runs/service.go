// Package runs runs an agent at a task end to end: the agent builds the app in a sandbox with only the gateway
// reachable, the platform snapshots the result, counts the code, starts the app, runs the task's API checks, takes
// screenshots and scores it by the share of checks passed (people rank the apps by voting, votes.go).
package runs

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/admin"
	"tolerance/internal/identity"
	"tolerance/internal/platform/db"
	"tolerance/internal/platform/httpx"
	"tolerance/internal/platform/idgen"
	"tolerance/internal/pricing"
	"tolerance/internal/tasks"
)

type Service struct {
	pool *db.Pool
	// PreviewURL is the live preview address template with {id} for the run's preview host label ("" = off).
	PreviewURL string
	// Slots is how many runs the worker runs at once (ARENA_RUN_CONCURRENCY), for the queue's wait estimate.
	Slots int
	// VoteAllowed rate-limits votes (by user and client address); nil = no limit.
	VoteAllowed func(r *http.Request, userID string) bool
	// GuestPairAllowed rate-limits the pairs handed to guests (by client address); nil = no limit.
	GuestPairAllowed func(r *http.Request) bool
}

func NewService(pool *db.Pool, previewURL string, slots int) *Service {
	return &Service{pool: pool, PreviewURL: previewURL, Slots: slots}
}

type AgentRef struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Provider    string `json:"provider"`
	Model       string `json:"model,omitempty"`      // pricing.Models slug; empty for an uploaded agent
	ModelName   string `json:"model_name,omitempty"` // its display name
	Owner       string `json:"owner"`
}

type Tokens struct {
	In         int64 `json:"in"`
	Out        int64 `json:"out"`
	CacheRead  int64 `json:"cache_read"`
	CacheWrite int64 `json:"cache_write"`
	Requests   int   `json:"requests"`
}

type Check struct {
	Name   string `json:"name"`
	Passed bool   `json:"passed"`
	Detail string `json:"detail,omitempty"`
}

type Stats struct {
	LOC           int            `json:"loc"`
	Files         int            `json:"files"`
	Languages     map[string]int `json:"languages"`
	StartSeconds  float64        `json:"start_seconds,omitempty"`
	ConsoleErrors int            `json:"console_errors"`
}

// Run is the full public view of a run.
type Run struct {
	ID            string     `json:"id"`
	Task          string     `json:"task"`
	TaskTitle     tasks.Text `json:"task_title"` // from the catalog; empty when the task left it
	Agent         AgentRef   `json:"agent"`
	Status        string     `json:"status"`
	FailureReason *string    `json:"failure_reason"`
	AgentExit     *string    `json:"agent_exit"`
	TimeLimitS    int        `json:"time_limit_s"`
	TokenBudget   int64      `json:"token_budget"`
	Tokens        Tokens     `json:"tokens"`
	// CostUSD is the tokens at the model's list price: nil when the model is unknown, 0 on a subscription.
	CostUSD       *float64 `json:"cost_usd"`
	AgentSeconds  *int     `json:"agent_seconds"`
	Stats         Stats    `json:"stats"`
	Checks        []Check  `json:"checks"`
	Score         *int     `json:"score"`
	AppStarted    bool     `json:"app_started"`
	HasShot       bool     `json:"has_shot"`
	HasShotMobile bool     `json:"has_shot_mobile"`
	HasSource     bool     `json:"has_source"`
	// HasSnapshot: the app's snapshot is still kept, so its checks can run again (Recheck).
	HasSnapshot bool   `json:"has_snapshot"`
	Rechecks    int    `json:"rechecks"`
	PreviewURL  string `json:"preview_url,omitempty"`
	AgentLog    string `json:"agent_log,omitempty"`
	// LogTail is the end of the agent's log, for lists: what it is doing now, or why it stopped.
	LogTail    string     `json:"log_tail"`
	CheckLog   string     `json:"check_log,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	StartedAt  *time.Time `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
	// A queued run's place (1 = next) and estimated seconds until it starts (absent while the queue is paused).
	QueuePosition *int `json:"queue_position,omitempty"`
	QueueWaitS    *int `json:"queue_wait_s,omitempty"`
	// Manifest is what the run was set up with; Agent.Provider and Agent.Model come from it, not from the agent now.
	Manifest Manifest `json:"manifest"`
	// Models is each model id the agent called, with its metered requests.
	Models map[string]int `json:"models"`
	// ChecksVersion is the checks that produced the score; ChecksCurrent says they are the task's current ones (only
	// such runs are ranked).
	ChecksVersion *string `json:"checks_version"`
	ChecksCurrent bool    `json:"checks_current"`
}

const runColumns = `r.id, r.task, a.id, a.name, a.description, r.manifest->>'provider', coalesce(r.manifest->>'model', ''), u.handle, r.status, r.failure_reason, r.agent_exit,
	r.time_limit_s, r.token_budget, r.tokens_in, r.tokens_out, r.tokens_cache_read, r.tokens_cache_write, r.llm_requests,
	r.agent_seconds, r.stats, r.checks, r.score, r.app_started,
	r.shot IS NOT NULL, r.shot_mobile IS NOT NULL, r.source_zip IS NOT NULL, r.image IS NOT NULL, r.rechecks,
	r.created_at, r.started_at, r.finished_at, right(r.agent_log, 800), r.manifest, r.models, r.checks_version`

const runFrom = ` FROM runs r JOIN agents a ON a.id = r.agent_id JOIN users u ON u.id = a.owner_id`

func scanRun(row pgx.Row, extra ...any) (Run, error) {
	var r Run
	var stats, checks, manifest, models []byte
	dest := []any{&r.ID, &r.Task, &r.Agent.ID, &r.Agent.Name, &r.Agent.Description, &r.Agent.Provider, &r.Agent.Model, &r.Agent.Owner,
		&r.Status, &r.FailureReason, &r.AgentExit, &r.TimeLimitS, &r.TokenBudget, &r.Tokens.In, &r.Tokens.Out,
		&r.Tokens.CacheRead, &r.Tokens.CacheWrite, &r.Tokens.Requests,
		&r.AgentSeconds, &stats, &checks, &r.Score, &r.AppStarted, &r.HasShot, &r.HasShotMobile, &r.HasSource,
		&r.HasSnapshot, &r.Rechecks, &r.CreatedAt, &r.StartedAt, &r.FinishedAt, &r.LogTail, &manifest, &models, &r.ChecksVersion}
	if err := row.Scan(append(dest, extra...)...); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return r, httpx.NotFound()
		}
		return r, err
	}
	if m := pricing.BySlug(r.Agent.Model); m != nil {
		r.Agent.ModelName = m.Name
	}
	r.CostUSD = pricing.Spent(r.Agent.Model, r.Agent.Provider, r.Tokens.In, r.Tokens.Out, r.Tokens.CacheRead, r.Tokens.CacheWrite)
	_ = json.Unmarshal(stats, &r.Stats)
	if r.Stats.Languages == nil {
		r.Stats.Languages = map[string]int{}
	}
	r.Checks = []Check{}
	_ = json.Unmarshal(checks, &r.Checks)
	_ = json.Unmarshal(manifest, &r.Manifest)
	r.Models = map[string]int{}
	_ = json.Unmarshal(models, &r.Models)
	r.CreatedAt = r.CreatedAt.UTC()
	for _, t := range []**time.Time{&r.StartedAt, &r.FinishedAt} {
		if *t != nil {
			u := (*t).UTC()
			*t = &u
		}
	}
	return r, nil
}

// PreviewHost is the run's label in the preview host name (ids are "run_<hex>"; hosts can't have "_").
func PreviewHost(runID string) string { return strings.TrimPrefix(runID, "run_") }

// ImageFor is the snapshot image of the run's workspace.
func ImageFor(runID string) string { return "arena-run:" + PreviewHost(runID) }

// decorate adds what comes from the catalog and the config, not the database: the task's title and the preview URL.
func (s *Service) decorate(r *Run) {
	t := tasks.BySlug(r.Task)
	if t != nil {
		r.TaskTitle = t.Title
		r.ChecksCurrent = r.ChecksVersion != nil && *r.ChecksVersion == checksVersion(t)
	}
	if s.PreviewURL != "" && r.Status == "done" && r.AppStarted && t != nil && t.UI {
		r.PreviewURL = strings.ReplaceAll(s.PreviewURL, "{id}", PreviewHost(r.ID))
	}
}

// Get returns one run with its logs.
func (s *Service) Get(ctx context.Context, id string) (Run, error) {
	var r Run
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var agentLog, checkLog string
		var err error
		r, err = scanRun(tx.QueryRow(ctx, `SELECT `+runColumns+`, r.agent_log, r.check_log`+runFrom+` WHERE r.id = $1`, id),
			&agentLog, &checkLog)
		r.AgentLog, r.CheckLog = agentLog, checkLog
		if err != nil {
			return err
		}
		one := []Run{r}
		err = s.placeQueued(ctx, tx, one)
		r = one[0]
		return err
	})
	s.decorate(&r)
	return r, err
}

func (s *Service) query(ctx context.Context, where string, args ...any) ([]Run, error) {
	out := []Run{}
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+runColumns+runFrom+` `+where, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			r, err := scanRun(rows)
			if err != nil {
				return err
			}
			s.decorate(&r)
			out = append(out, r)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		rows.Close()
		return s.placeQueued(ctx, tx, out)
	})
	return out, err
}

// Recent lists the latest runs, optionally of one task, one agent or in one status.
func (s *Service) Recent(ctx context.Context, task, agentID, status string, limit int) ([]Run, error) {
	return s.query(ctx, `WHERE ($1 = '' OR r.task = $1) AND ($2 = '' OR r.agent_id = $2) AND ($3 = '' OR r.status = $3)
		ORDER BY r.created_at DESC LIMIT $4`, task, agentID, status, limit)
}

// Active lists every queued and running run, oldest first.
func (s *Service) Active(ctx context.Context) ([]Run, error) {
	return s.query(ctx, `WHERE r.status IN ('queued', 'agent', 'checking') ORDER BY r.created_at`)
}

// Latest is the newest run of each of ownerID's agents at each task: the cells of the agents × tasks table on /my.
func (s *Service) Latest(ctx context.Context, ownerID string) ([]Run, error) {
	return s.query(ctx, `WHERE r.id IN (SELECT DISTINCT ON (agent_id, task) id FROM runs
		WHERE agent_id IN (SELECT id FROM agents WHERE owner_id = $1) ORDER BY agent_id, task, created_at DESC)
		ORDER BY r.created_at DESC`, ownerID)
}

// Mine lists the latest runs of ownerID's agents.
func (s *Service) Mine(ctx context.Context, ownerID string, limit int) ([]Run, error) {
	return s.query(ctx, `WHERE a.owner_id = $1 ORDER BY r.created_at DESC LIMIT $2`, ownerID, limit)
}

// rankedLimits keeps a ranking to runs within the task's limits ($2 time, $3 budget): an admin's run with more
// rankedLimits keeps a ranking to runs within the task's limits ($2 time, $3 budget): an admin's run with more
// time or tokens is an experiment, not a result to compare. And to runs scored by the task's current checks ($4):
// scores from other checks aren't comparable (an admin can re-check an older run's snapshot to bring it back). A run
// that spent more than its budget (the gateway's reservations keep that rare, see internal/gateway/budget.go) isn't
// ranked either, by any margin.
const rankedLimits = ` AND time_limit_s <= $2 AND token_budget <= $3 AND checks_version = $4
	AND tokens_in + tokens_out + tokens_cache_write <= token_budget`

func taskLimits(task string) (int, int64, string) {
	if t := tasks.BySlug(task); t != nil {
		return t.TimeLimitS, t.TokenBudget, checksVersion(t)
	}
	return 0, 0, ""
}

// Compare is each agent's best finished run at the task: best score first, then the newest.
func (s *Service) Compare(ctx context.Context, task string) ([]Run, error) {
	limit, budget, checks := taskLimits(task)
	return s.query(ctx, `WHERE r.id IN (
			SELECT DISTINCT ON (agent_id) id FROM runs WHERE task = $1 AND status = 'done'`+rankedLimits+`
			ORDER BY agent_id, score DESC NULLS LAST, created_at DESC)
		ORDER BY r.score DESC NULLS LAST, r.created_at DESC`, task, limit, budget, checks)
}

// Leaderboard is each agent's best finished run at the task, best first (ties: fewer tokens, then faster).
func (s *Service) Leaderboard(ctx context.Context, task string) ([]Run, error) {
	limit, budget, checks := taskLimits(task)
	return s.query(ctx, `WHERE r.id IN (
			SELECT DISTINCT ON (agent_id) id FROM runs WHERE task = $1 AND status = 'done' AND score IS NOT NULL`+rankedLimits+`
			ORDER BY agent_id, score DESC, tokens_in + tokens_out + tokens_cache_write, agent_seconds NULLS LAST)
		ORDER BY r.score DESC, r.tokens_in + r.tokens_out + r.tokens_cache_write, r.agent_seconds NULLS LAST`, task, limit, budget, checks)
}

// TaskSummary is a task with its standing, for the home page.
type TaskSummary struct {
	Slug        string     `json:"slug"`
	Title       tasks.Text `json:"title"`
	Tagline     tasks.Text `json:"tagline"`
	TimeLimitS  int        `json:"time_limit_s"`
	TokenBudget int64      `json:"token_budget"`
	CheckCount  int        `json:"check_count"` // every check a run gets, the hidden ones included
	HiddenCount int        `json:"hidden_count"`
	Runs        int        `json:"runs"`
	Agents      int        `json:"agents"`
	Best        *Run       `json:"best"`
	Leaderboard []Run      `json:"leaderboard"`
}

// Summary is one task with its counts and leaderboard.
func (s *Service) Summary(ctx context.Context, t *tasks.Task) (TaskSummary, error) {
	ts := TaskSummary{Slug: t.Slug, Title: t.Title, Tagline: t.Tagline, TimeLimitS: t.TimeLimitS, TokenBudget: t.TokenBudget, CheckCount: len(t.CheckNames()) + len(t.Hidden), HiddenCount: len(t.Hidden)}
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*), count(DISTINCT agent_id) FROM runs WHERE task = $1`, t.Slug).Scan(&ts.Runs, &ts.Agents)
	})
	if err != nil {
		return ts, err
	}
	if ts.Leaderboard, err = s.Leaderboard(ctx, t.Slug); err != nil {
		return ts, err
	}
	if len(ts.Leaderboard) > 0 {
		ts.Best = &ts.Leaderboard[0]
	}
	return ts, nil
}

// Summaries is every task with its leaderboard: all the home page and the standings need, in one request.
func (s *Service) Summaries(ctx context.Context) ([]TaskSummary, error) {
	out := []TaskSummary{}
	for _, t := range tasks.All() {
		ts, err := s.Summary(ctx, t)
		if err != nil {
			return nil, err
		}
		out = append(out, ts)
	}
	return out, nil
}

func invalid(msg string) error { return httpx.New(http.StatusBadRequest, "invalid_run", msg) }

// Per-user limits for non-admins: one run server is shared by everyone. The daily limit counts run_quota rows, which
// stay when a run or its agent is deleted. Only the worker's infra_error (the platform's fault) gives the quota back
// (refundQuota); a cancel doesn't, whoever made it: the run took a slot and may have spent tokens.
const (
	maxOpenRunsPerUser  = 3
	maxDailyRunsPerUser = 30
)

// refundQuota wraps an UPDATE of runs to infra_error ending in RETURNING id: it also gives those runs' daily quota
// back, and returns how many runs the UPDATE changed.
func refundQuota(update string) string {
	return `WITH f AS (` + update + `), q AS (UPDATE run_quota SET refunded = true WHERE run_id IN (SELECT id FROM f))
		SELECT count(*) FROM f`
}

// Create queues a run of agentID at task. Zero limits take the task's defaults. ownerID is the caller's scope
// (identity.OwnerScope): a user may run only their own agents, within the per-user limits and the task's time limit
// and token budget; "" (an admin) may run any agent with any limits (runs over the task's are left out of the rankings).
func (s *Service) Create(ctx context.Context, ownerID, agentID, task string, timeLimitS int, tokenBudget int64) (Run, error) {
	t := tasks.BySlug(task)
	if t == nil {
		return Run{}, invalid("Unknown task")
	}
	if timeLimitS == 0 {
		timeLimitS = t.TimeLimitS
	}
	if tokenBudget == 0 {
		tokenBudget = t.TokenBudget
	}
	if timeLimitS < 60 || timeLimitS > 4*3600 {
		return Run{}, invalid("The time limit must be between 1 minute and 4 hours")
	}
	if ownerID != "" && timeLimitS > t.TimeLimitS {
		return Run{}, invalid("The time limit can't be longer than the task's")
	}
	if ownerID != "" && tokenBudget > t.TokenBudget {
		return Run{}, invalid("The token budget can't be larger than the task's")
	}
	if tokenBudget < 10_000 || tokenBudget > 50_000_000 {
		return Run{}, invalid("The token budget must be between 10k and 50M")
	}
	id := idgen.New("run")
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if ownerID != "" {
			// The user's row lock serializes their creates: a parallel one waits here and then counts this run.
			if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE`, ownerID); err != nil {
				return err
			}
			if err := admin.CanCreate(ctx, tx, ownerID); err != nil {
				return err
			}
			var open, day int
			if err := tx.QueryRow(ctx, `SELECT
					(SELECT count(*) FROM runs r JOIN agents a ON a.id = r.agent_id
						WHERE a.owner_id = $1 AND r.status IN ('queued', 'agent', 'checking')),
					(SELECT count(*) FROM run_quota WHERE user_id = $1 AND NOT refunded AND created_at > now() - interval '1 day')`,
				ownerID).Scan(&open, &day); err != nil {
				return err
			}
			if open >= maxOpenRunsPerUser {
				return httpx.New(http.StatusTooManyRequests, "too_many_runs", "You already have 3 runs queued or running: wait for one to finish")
			}
			if day >= maxDailyRunsPerUser {
				return httpx.New(http.StatusTooManyRequests, "too_many_runs", "You have started 30 runs in the last 24 hours: try again later")
			}
		}
		var provider, model, bundleHash, agentOwner string
		err := tx.QueryRow(ctx, `SELECT provider, model, encode(sha256(bundle), 'hex'), owner_id FROM agents WHERE id = $1 AND ($2 = '' OR owner_id = $2)`,
			agentID, ownerID).Scan(&provider, &model, &bundleHash, &agentOwner)
		if errors.Is(err, pgx.ErrNoRows) {
			return invalid("Unknown agent")
		}
		if err != nil {
			return err
		}
		// A personal subscription is spent only by its owner: an admin may run anyone's agent, but not on that.
		if pricing.Subscription(provider) {
			if a, ok := identity.FromContext(ctx); !ok || a.UserID != agentOwner {
				return invalid("Only its owner can run an agent on a personal subscription")
			}
		}
		manifest, err := json.Marshal(newManifest(t, provider, model, bundleHash))
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO runs (id, agent_id, task, time_limit_s, token_budget, manifest) VALUES ($1, $2, $3, $4, $5, $6)`,
			id, agentID, task, timeLimitS, tokenBudget, manifest)
		if err == nil && ownerID != "" {
			_, err = tx.Exec(ctx, `INSERT INTO run_quota (run_id, user_id) VALUES ($1, $2)`, id, ownerID)
		}
		return err
	})
	if err != nil {
		return Run{}, err
	}
	return s.Get(ctx, id)
}

// ownRun limits a statement on runs r to the runs of ownerID's agents ("" = any run); ownerID is argument $2.
const ownRun = ` AND ($2 = '' OR agent_id IN (SELECT id FROM agents WHERE owner_id = $2))`

// Cancel stops a run that hasn't finished; the worker notices and kills its container.
func (s *Service) Cancel(ctx context.Context, ownerID, id string) error {
	return s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE runs SET status = 'infra_error', failure_reason = 'cancelled', finished_at = now(), updated_at = now()
			WHERE id = $1 AND status IN ('queued', 'agent', 'checking')`+ownRun, id, ownerID)
		if err == nil && tag.RowsAffected() == 0 {
			return httpx.StateConflict("The run has already finished, or it isn't yours")
		}
		return err
	})
}

// Recheck queues a finished run again to check its app only: the worker starts it from the kept snapshot and runs
// the current checks, without the agent (no tokens, same code). The new result replaces the old one. For an
// infra_error in the checks, or after the checks changed.
func (s *Service) Recheck(ctx context.Context, id string) error {
	return s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var status string
		var snapshot bool
		err := tx.QueryRow(ctx, `SELECT status, image IS NOT NULL AND agent_exit IS NOT NULL FROM runs WHERE id = $1 FOR UPDATE`, id).Scan(&status, &snapshot)
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.NotFound()
		}
		if err != nil {
			return err
		}
		if status != "done" && status != "infra_error" {
			return httpx.StateConflict("The run is still going")
		}
		if !snapshot {
			return httpx.StateConflict("The run's snapshot is gone (or the agent never finished): it can't be checked again")
		}
		_, err = tx.Exec(ctx, `UPDATE runs SET status = 'queued', recheck = true, rechecks = rechecks + 1, failure_reason = NULL,
			finished_at = NULL, updated_at = now() WHERE id = $1`, id)
		return err
	})
}

// Delete removes a run (and, best effort, its image: the caller does that).
func (s *Service) Delete(ctx context.Context, ownerID, id string) error {
	return s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM runs WHERE id = $1 AND status NOT IN ('agent', 'checking')`+ownRun, id, ownerID)
		if err == nil && tag.RowsAffected() == 0 {
			return httpx.StateConflict("Unknown run, not yours, or still running (cancel it first)")
		}
		return err
	})
}

// Blob returns one of the run's stored files: shot, shot_mobile or source_zip.
func (s *Service) Blob(ctx context.Context, id, column string) ([]byte, error) {
	switch column {
	case "shot", "shot_mobile", "source_zip":
	default:
		return nil, httpx.NotFound()
	}
	var b []byte
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT `+column+` FROM runs WHERE id = $1`, id).Scan(&b)
	})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && b == nil) {
		return nil, httpx.NotFound()
	}
	return b, err
}
