package runs

import (
	"bytes"
	"context"
	"encoding/csv"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/platform/httpx"
	"tolerance/internal/pricing"
	"tolerance/internal/tasks"
)

// ExportRun is one ranked run in the open dataset: what anyone needs to recount the leaderboard. Nothing about the
// owner (no user id, email or handle) and nothing an agent wrote.
type ExportRun struct {
	ID       string `json:"id"`
	Task     string `json:"task"`
	TaskKind string `json:"task_kind"`
	AgentID  string `json:"agent_id"`
	Agent    string `json:"agent"`
	CLI      string `json:"cli"`      // the ready agent it was made from; "" for an uploaded one
	Model    string `json:"model"`    // internal/pricing slug; "" for an uploaded agent
	Provider string `json:"provider"` // whose key or subscription it ran on
	Score    int    `json:"score"`
	// Median: the run the agent stands on at the task (medianRuns).
	Median       bool  `json:"median"`
	ChecksPassed int   `json:"checks_passed"`
	Checks       int   `json:"checks"`
	TokensIn     int64 `json:"tokens_in"`
	TokensOut    int64 `json:"tokens_out"`
	CacheRead    int64 `json:"tokens_cache_read"`
	CacheWrite   int64 `json:"tokens_cache_write"`
	// CostUSD is the tokens at the model's list price, a subscription's too (Subscription says so); nil when the
	// model is unknown.
	CostUSD       *float64  `json:"cost_usd"`
	Subscription  bool      `json:"subscription"`
	AgentSeconds  *int      `json:"agent_seconds"`
	ChecksVersion string    `json:"checks_version"`
	CreatedAt     time.Time `json:"created_at"`
}

// exportTTL keeps the dataset: it replays every task's rankings and changes only when a run finishes.
const exportTTL = time.Minute

// Export lists every ranked run (the runs the leaderboard picks medians from), by task, then newest first.
func (s *Service) Export(ctx context.Context) ([]ExportRun, error) {
	out := []ExportRun{}
	for _, t := range tasks.All() {
		median, err := s.medianRuns(ctx, t.Slug)
		if err != nil {
			return nil, err
		}
		limit, budget, checks := taskLimits(t.Slug)
		err = s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
			rows, err := tx.Query(ctx, `SELECT r.id, a.id, a.name, a.example, coalesce(r.manifest->>'model', ''),
					coalesce(r.manifest->>'provider', ''), r.score,
					(SELECT count(*) FROM jsonb_array_elements(r.checks) c WHERE (c->>'passed')::boolean), jsonb_array_length(r.checks),
					r.tokens_in, r.tokens_out, r.tokens_cache_read, r.tokens_cache_write, r.agent_seconds, r.checks_version, r.created_at
				FROM runs r JOIN agents a ON a.id = r.agent_id
				WHERE r.task = $1 AND r.status = 'done' AND r.score IS NOT NULL`+rankedLimits+`
				ORDER BY r.created_at DESC`, t.Slug, limit, budget, checks)
			if err != nil {
				return err
			}
			defer rows.Close()
			for rows.Next() {
				e := ExportRun{Task: t.Slug, TaskKind: t.Kind}
				if err := rows.Scan(&e.ID, &e.AgentID, &e.Agent, &e.CLI, &e.Model, &e.Provider, &e.Score, &e.ChecksPassed, &e.Checks,
					&e.TokensIn, &e.TokensOut, &e.CacheRead, &e.CacheWrite, &e.AgentSeconds, &e.ChecksVersion, &e.CreatedAt); err != nil {
					return err
				}
				_, e.Median = median[e.ID]
				e.CostUSD = pricing.Cost(e.Model, e.TokensIn, e.TokensOut, e.CacheRead, e.CacheWrite)
				e.Subscription = pricing.Subscription(e.Provider)
				e.CreatedAt = e.CreatedAt.UTC()
				out = append(out, e)
			}
			return rows.Err()
		})
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

func exportCSV(rows []ExportRun) []byte {
	var b bytes.Buffer
	w := csv.NewWriter(&b)
	_ = w.Write([]string{"id", "task", "task_kind", "agent_id", "agent", "cli", "model", "provider", "score", "median",
		"checks_passed", "checks", "tokens_in", "tokens_out", "tokens_cache_read", "tokens_cache_write", "cost_usd",
		"subscription", "agent_seconds", "checks_version", "created_at"})
	i64 := func(n int64) string { return strconv.FormatInt(n, 10) }
	for _, e := range rows {
		cost, secs := "", ""
		if e.CostUSD != nil {
			cost = strconv.FormatFloat(*e.CostUSD, 'f', 4, 64)
		}
		if e.AgentSeconds != nil {
			secs = strconv.Itoa(*e.AgentSeconds)
		}
		_ = w.Write([]string{e.ID, e.Task, e.TaskKind, e.AgentID, e.Agent, e.CLI, e.Model, e.Provider, strconv.Itoa(e.Score),
			strconv.FormatBool(e.Median), strconv.Itoa(e.ChecksPassed), strconv.Itoa(e.Checks), i64(e.TokensIn), i64(e.TokensOut),
			i64(e.CacheRead), i64(e.CacheWrite), cost, strconv.FormatBool(e.Subscription), secs, e.ChecksVersion,
			e.CreatedAt.Format(time.RFC3339)})
	}
	w.Flush()
	return b.Bytes()
}

// RegisterExportRoutes mounts the open dataset: the ranked runs as CSV and JSON.
func RegisterExportRoutes(mux *http.ServeMux, s *Service) {
	load := func(r *http.Request) ([]ExportRun, error) {
		return memoize(&s.public, "export", exportTTL, func() ([]ExportRun, error) { return s.Export(r.Context()) })
	}
	mux.HandleFunc("GET /api/v1/export/runs.json", func(w http.ResponseWriter, r *http.Request) {
		rows, err := load(r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=60")
		httpx.Respond(w, http.StatusOK, map[string]any{"items": rows})
	})
	mux.HandleFunc("GET /api/v1/export/runs.csv", func(w http.ResponseWriter, r *http.Request) {
		rows, err := load(r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="tolerance-runs.csv"`)
		w.Header().Set("Cache-Control", "public, max-age=60")
		_, _ = w.Write(exportCSV(rows))
	})
}
