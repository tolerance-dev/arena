package runs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/identity"
	"tolerance/internal/platform/db"
	"tolerance/internal/platform/httpx"
	"tolerance/internal/platform/idgen"
	"tolerance/internal/pricing"
	"tolerance/internal/tasks"
)

// The tournament keeps the rankings alive whether or not users come: every ready agent of the site owner
// (identity.OwnerEmail) at every task, tournamentRounds runs each, queued at once. The owner's agents are its
// players, so the owner picks them on /my; a run spends the agent's own key, a subscription included (only the owner
// may start one). Weekly, the worker queues it once each ISO week after Monday tournamentHour:00 UTC, if the owner
// switched it on before then (settings.tournament_since); the owner may also start one by hand on /admin. A new one
// waits while the last one still has runs open. Its runs are ordinary ranked runs at the task's limits; in the queue
// they are the owner's, so round-robin puts each user's next run ahead of the tournament's pile.
const (
	tournamentRounds = 3
	tournamentHour   = 3
	// tournamentLock serializes starting tournaments: the open check and the inserts must not interleave.
	tournamentLock = 7_301_002
)

var (
	errTournamentOpen = httpx.New(http.StatusConflict, "tournament_running", "The last tournament still has runs open")
	errNoPlayers      = httpx.New(http.StatusConflict, "tournament_no_agents", "The site owner has no ready agents to play")
	errNotOwner       = httpx.New(http.StatusForbidden, "not_owner", "Only the site owner runs the tournament")
)

// weekSlot is the ISO week now falls in ('2026-W44') and when that week's tournament is due: its Monday at
// tournamentHour:00 UTC.
func weekSlot(now time.Time) (string, time.Time) {
	now = now.UTC()
	y, wk := now.ISOWeek()
	back := (int(now.Weekday()) + 6) % 7 // days since Monday
	d := now.AddDate(0, 0, -back)
	return fmt.Sprintf("%d-W%02d", y, wk), time.Date(d.Year(), d.Month(), d.Day(), tournamentHour, 0, 0, 0, time.UTC)
}

// ownerID is the site owner's user id, "" before they first sign in or when there is no owner.
func ownerID(ctx context.Context, tx pgx.Tx) (string, error) {
	if identity.OwnerEmail == "" {
		return "", nil
	}
	var id string
	err := tx.QueryRow(ctx, `SELECT id FROM users WHERE lower(email) = lower($1) ORDER BY created_at LIMIT 1`, identity.OwnerEmail).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// Player is an agent that plays the tournament.
type Player struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Provider  string `json:"provider"`
	Model     string `json:"model"`
	ModelName string `json:"model_name,omitempty"`
}

type player struct {
	Player
	bundleHash string
}

// players are the owner's ready agents (a ready agent has a model; an uploaded one hasn't), oldest first.
func players(ctx context.Context, tx pgx.Tx, owner string) ([]player, error) {
	rows, err := tx.Query(ctx, `SELECT id, name, provider, model, encode(sha256(bundle), 'hex') FROM agents
		WHERE owner_id = $1 AND model <> '' ORDER BY created_at, id`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []player{}
	for rows.Next() {
		var p player
		if err := rows.Scan(&p.ID, &p.Name, &p.Provider, &p.Model, &p.bundleHash); err != nil {
			return nil, err
		}
		if m := pricing.BySlug(p.Model); m != nil {
			p.ModelName = m.Name
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// startTournament queues a tournament inside tx: week is the ISO week of a scheduled one ("" = by hand). It returns
// how many runs it queued, 0 when that week's tournament is already queued.
func startTournament(ctx context.Context, tx pgx.Tx, week string) (int, error) {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, tournamentLock); err != nil {
		return 0, err
	}
	var open bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM runs WHERE tournament_id IS NOT NULL
			AND status IN ('queued', 'agent', 'checking'))`).Scan(&open); err != nil {
		return 0, err
	}
	if open {
		return 0, errTournamentOpen
	}
	owner, err := ownerID(ctx, tx)
	if err != nil {
		return 0, err
	}
	var ps []player
	if owner != "" {
		if ps, err = players(ctx, tx, owner); err != nil {
			return 0, err
		}
	}
	if len(ps) == 0 {
		return 0, errNoPlayers
	}
	id := idgen.New("trn")
	var wk *string
	if week != "" {
		wk = &week
	}
	tag, err := tx.Exec(ctx, `INSERT INTO tournaments (id, week) VALUES ($1, $2) ON CONFLICT (week) DO NOTHING`, id, wk)
	if err != nil {
		return 0, err
	}
	if tag.RowsAffected() == 0 {
		return 0, nil
	}
	// Round by round, so the first runs to finish cover every agent and task. created_at steps by a microsecond:
	// within one owner the queue goes by it.
	n := 0
	for round := 0; round < tournamentRounds; round++ {
		for _, t := range tasks.All() {
			for _, p := range ps {
				manifest, err := json.Marshal(newManifest(t, p.Provider, p.Model, p.bundleHash))
				if err != nil {
					return 0, err
				}
				if _, err := tx.Exec(ctx, `INSERT INTO runs (id, agent_id, task, time_limit_s, token_budget, manifest, tournament_id, created_at)
						VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8::float8 / 1e6))`,
					idgen.New("run"), p.ID, t.Slug, t.TimeLimitS, t.TokenBudget, manifest, id, n); err != nil {
					return 0, err
				}
				n++
			}
		}
	}
	return n, nil
}

// ScheduleTournament queues this week's tournament once it is due, if the weekly one is on; the worker calls it
// every minute. It returns how many runs it queued (0: not due, already queued, or nothing to play). While the last
// tournament is still going it waits, and queues this week's once that one ends.
func ScheduleTournament(ctx context.Context, pool *db.Pool, now time.Time) (int, error) {
	var n int
	err := pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var since *time.Time
		if err := tx.QueryRow(ctx, `SELECT tournament_since FROM settings`).Scan(&since); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		week, due := weekSlot(now)
		if since == nil || now.Before(due) || due.Before(*since) {
			return nil
		}
		var err error
		n, err = startTournament(ctx, tx, week)
		if errors.Is(err, errTournamentOpen) || errors.Is(err, errNoPlayers) {
			return nil
		}
		return err
	})
	return n, err
}

// TournamentRecord is one tournament with how its runs are doing.
type TournamentRecord struct {
	ID        string    `json:"id"`
	Week      *string   `json:"week"` // nil: started by hand
	CreatedAt time.Time `json:"created_at"`
	Runs      int       `json:"runs"`
	Open      int       `json:"open"`
	Done      int       `json:"done"`
	Failed    int       `json:"failed"` // infra_error: the platform's fault or a cancel
	CostUSD   float64   `json:"cost_usd"`
}

// Tournament is the tournament block of /admin.
type Tournament struct {
	CanManage bool               `json:"can_manage"` // the viewer is the site owner
	Weekly    bool               `json:"weekly"`
	NextAt    *time.Time         `json:"next_at"` // when the next weekly one is due (nil: off)
	Rounds    int                `json:"rounds"`
	Tasks     int                `json:"tasks"`
	Players   []Player           `json:"players"`
	Recent    []TournamentRecord `json:"recent"`
}

// TournamentState is the tournament as viewerID (an admin) sees it.
func (s *Service) TournamentState(ctx context.Context, viewerID string, now time.Time) (Tournament, error) {
	out := Tournament{Rounds: tournamentRounds, Tasks: len(tasks.All()), Players: []Player{}, Recent: []TournamentRecord{}}
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		owner, err := ownerID(ctx, tx)
		if err != nil {
			return err
		}
		out.CanManage = owner != "" && owner == viewerID
		var since *time.Time
		if err := tx.QueryRow(ctx, `SELECT tournament_since FROM settings`).Scan(&since); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if since != nil {
			out.Weekly = true
			week, due := weekSlot(now)
			var queued bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM tournaments WHERE week = $1)`, week).Scan(&queued); err != nil {
				return err
			}
			if queued || due.Before(*since) {
				due = due.AddDate(0, 0, 7)
			}
			out.NextAt = &due
		}
		if owner != "" {
			ps, err := players(ctx, tx, owner)
			if err != nil {
				return err
			}
			for _, p := range ps {
				out.Players = append(out.Players, p.Player)
			}
		}
		rows, err := tx.Query(ctx, `SELECT t.id, t.week, t.created_at, count(r.id),
				count(r.id) FILTER (WHERE r.status IN ('queued', 'agent', 'checking')),
				count(r.id) FILTER (WHERE r.status = 'done'), count(r.id) FILTER (WHERE r.status = 'infra_error')
			FROM tournaments t LEFT JOIN runs r ON r.tournament_id = t.id
			GROUP BY t.id ORDER BY t.created_at DESC LIMIT 10`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var r TournamentRecord
			if err := rows.Scan(&r.ID, &r.Week, &r.CreatedAt, &r.Runs, &r.Open, &r.Done, &r.Failed); err != nil {
				return err
			}
			r.CreatedAt = r.CreatedAt.UTC()
			out.Recent = append(out.Recent, r)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		rows.Close()
		// Cost at list price, a subscription included: what the tournament would cost on API keys.
		for i := range out.Recent {
			cr, err := tx.Query(ctx, `SELECT manifest->>'model', tokens_in, tokens_out, tokens_cache_read, tokens_cache_write
				FROM runs WHERE tournament_id = $1`, out.Recent[i].ID)
			if err != nil {
				return err
			}
			for cr.Next() {
				var model *string
				var in, o, crd, cw int64
				if err := cr.Scan(&model, &in, &o, &crd, &cw); err != nil {
					cr.Close()
					return err
				}
				if model != nil {
					if c := pricing.Cost(*model, in, o, crd, cw); c != nil {
						out.Recent[i].CostUSD += *c
					}
				}
			}
			cr.Close()
			if err := cr.Err(); err != nil {
				return err
			}
		}
		return nil
	})
	return out, err
}

// owner refuses anyone but the site owner.
func (s *Service) owner(ctx context.Context, tx pgx.Tx, userID string) error {
	owner, err := ownerID(ctx, tx)
	if err != nil {
		return err
	}
	if owner == "" || owner != userID {
		return errNotOwner
	}
	return nil
}

// StartTournament queues a tournament now, by hand; only the site owner may.
func (s *Service) StartTournament(ctx context.Context, userID string) (int, error) {
	var n int
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if err := s.owner(ctx, tx, userID); err != nil {
			return err
		}
		var err error
		n, err = startTournament(ctx, tx, "")
		return err
	})
	return n, err
}

// SetTournamentWeekly switches the weekly tournament on (from now: the first one is the next Monday's, unless this
// week's is still ahead) or off; only the site owner may.
func (s *Service) SetTournamentWeekly(ctx context.Context, userID string, on bool) error {
	return s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if err := s.owner(ctx, tx, userID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE settings SET tournament_since = CASE WHEN $1 THEN coalesce(tournament_since, now()) END,
			updated_at = now()`, on)
		return err
	})
}
