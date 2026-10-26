// Package admin is the platform owner's control panel: where the tokens go, who spends them, and the switches that
// stop it (pause the queue, close runs to non-admins, block a user, cancel everything).
package admin

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/platform/db"
	"tolerance/internal/platform/httpx"
	"tolerance/internal/pricing"
)

// Settings are the platform switches (the one row of the settings table).
type Settings struct {
	RunsPaused bool `json:"runs_paused"` // the worker takes no queued runs
	UserRuns   bool `json:"user_runs"`   // non-admins may upload agents and start runs
}

// Load reads the switches inside tx.
func Load(ctx context.Context, tx pgx.Tx) (Settings, error) {
	var s Settings
	err := tx.QueryRow(ctx, `SELECT runs_paused, user_runs FROM settings`).Scan(&s.RunsPaused, &s.UserRuns)
	if errors.Is(err, pgx.ErrNoRows) {
		return Settings{UserRuns: true}, nil
	}
	return s, err
}

// CanCreate refuses a non-admin's upload or run while the admin has closed them, or blocked the user.
func CanCreate(ctx context.Context, tx pgx.Tx, userID string) error {
	s, err := Load(ctx, tx)
	if err != nil {
		return err
	}
	if !s.UserRuns {
		return httpx.New(http.StatusForbidden, "runs_closed", "New agents and runs are paused for now: try again later")
	}
	var blocked bool
	if err := tx.QueryRow(ctx, `SELECT blocked FROM users WHERE id = $1`, userID).Scan(&blocked); err != nil {
		return err
	}
	if blocked {
		return httpx.New(http.StatusForbidden, "blocked", "Your account can't upload agents or start runs")
	}
	return nil
}

type Service struct{ pool *db.Pool }

func NewService(pool *db.Pool) *Service { return &Service{pool: pool} }

// Spend is what runs created in a period used (on each agent's own key).
type Spend struct {
	Period     string `json:"period"` // 24h | 7d | 30d | all
	Runs       int    `json:"runs"`
	Failed     int    `json:"failed"` // infra_error, not counting cancels
	In         int64  `json:"in"`
	Out        int64  `json:"out"`
	CacheRead  int64  `json:"cache_read"`
	CacheWrite int64  `json:"cache_write"`
	Requests   int64  `json:"requests"`
	// CostUSD is those tokens at list prices (internal/pricing), on the owners' keys; Unpriced counts the runs it
	// leaves out: uploaded agents, whose model is unknown.
	CostUSD  float64 `json:"cost_usd"`
	Unpriced int     `json:"unpriced"`
}

// ProviderSpend is the last 30 days' agent tokens by where the key is spent.
type ProviderSpend struct {
	Provider string `json:"provider"`
	Runs     int    `json:"runs"`
	Used     int64  `json:"used"`
}

type User struct {
	ID        string     `json:"id"`
	Handle    string     `json:"handle"`
	Email     string     `json:"email"`
	Role      string     `json:"role"`
	Blocked   bool       `json:"blocked"`
	Agents    int        `json:"agents"`
	Runs30d   int        `json:"runs_30d"`
	OpenRuns  int        `json:"open_runs"`
	Used30d   int64      `json:"used_30d"`
	Cost30d   float64    `json:"cost_30d"` // dollars at list prices on API keys (subscriptions and uploaded agents left out)
	LastRunAt *time.Time `json:"last_run_at"`
	CreatedAt time.Time  `json:"created_at"`
}

type Overview struct {
	Settings  Settings        `json:"settings"`
	Spend     []Spend         `json:"spend"`
	Providers []ProviderSpend `json:"providers"`
	Users     []User          `json:"users"`
	Queued    int             `json:"queued"`
	Running   int             `json:"running"`
}

func (s *Service) Overview(ctx context.Context) (Overview, error) {
	o := Overview{Spend: []Spend{}, Providers: []ProviderSpend{}, Users: []User{}}
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		if o.Settings, err = Load(ctx, tx); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status = 'queued'), count(*) FILTER (WHERE status IN ('agent', 'checking'))
			FROM runs WHERE status IN ('queued', 'agent', 'checking')`).Scan(&o.Queued, &o.Running); err != nil {
			return err
		}
		for _, p := range []struct{ name, since string }{{"24h", "1 day"}, {"7d", "7 days"}, {"30d", "30 days"}, {"all", "100 years"}} {
			sp := Spend{Period: p.name}
			if err := tx.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE status = 'infra_error' AND failure_reason IS DISTINCT FROM 'cancelled'),
					coalesce(sum(tokens_in), 0), coalesce(sum(tokens_out), 0), coalesce(sum(tokens_cache_read), 0),
					coalesce(sum(tokens_cache_write), 0), coalesce(sum(llm_requests), 0)
				FROM runs WHERE created_at > now() - $1::interval`, p.since).Scan(&sp.Runs, &sp.Failed, &sp.In, &sp.Out,
				&sp.CacheRead, &sp.CacheWrite, &sp.Requests); err != nil {
				return err
			}
			if err := priceSpend(ctx, tx, p.since, &sp); err != nil {
				return err
			}
			o.Spend = append(o.Spend, sp)
		}
		rows, err := tx.Query(ctx, `SELECT a.provider, count(*), coalesce(sum(r.tokens_in + r.tokens_cache_write + r.tokens_out), 0)
			FROM runs r JOIN agents a ON a.id = r.agent_id WHERE r.created_at > now() - interval '30 days'
			GROUP BY a.provider ORDER BY 3 DESC`)
		if err != nil {
			return err
		}
		for rows.Next() {
			var p ProviderSpend
			if err := rows.Scan(&p.Provider, &p.Runs, &p.Used); err != nil {
				rows.Close()
				return err
			}
			o.Providers = append(o.Providers, p)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		const month = `r.created_at > now() - interval '30 days'`
		rows, err = tx.Query(ctx, `SELECT u.id, u.handle, u.email, u.role, u.blocked, u.created_at,
				(SELECT count(*) FROM agents WHERE owner_id = u.id),
				count(r.id) FILTER (WHERE `+month+`),
				count(r.id) FILTER (WHERE r.status IN ('queued', 'agent', 'checking')),
				coalesce(sum(r.tokens_in + r.tokens_cache_write + r.tokens_out) FILTER (WHERE `+month+`), 0),
				max(r.created_at)
			FROM users u LEFT JOIN agents a ON a.owner_id = u.id LEFT JOIN runs r ON r.agent_id = a.id
			GROUP BY u.id ORDER BY 10 DESC, 11 DESC NULLS LAST, u.created_at DESC LIMIT 200`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var u User
			if err := rows.Scan(&u.ID, &u.Handle, &u.Email, &u.Role, &u.Blocked, &u.CreatedAt, &u.Agents, &u.Runs30d,
				&u.OpenRuns, &u.Used30d, &u.LastRunAt); err != nil {
				return err
			}
			u.CreatedAt = u.CreatedAt.UTC()
			if u.LastRunAt != nil {
				t := u.LastRunAt.UTC()
				u.LastRunAt = &t
			}
			o.Users = append(o.Users, u)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		rows.Close()
		return priceUsers(ctx, tx, o.Users)
	})
	return o, err
}

// priceSpend adds the dollar cost of the runs created since `since` (a Postgres interval).
func priceSpend(ctx context.Context, tx pgx.Tx, since string, sp *Spend) error {
	rows, err := tx.Query(ctx, `SELECT a.model, a.provider, count(*), coalesce(sum(r.tokens_in), 0), coalesce(sum(r.tokens_out), 0),
			coalesce(sum(r.tokens_cache_read), 0), coalesce(sum(r.tokens_cache_write), 0)
		FROM runs r JOIN agents a ON a.id = r.agent_id WHERE r.created_at > now() - $1::interval
		GROUP BY a.model, a.provider`, since)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var model, provider string
		var n int
		var in, out, cr, cw int64
		if err := rows.Scan(&model, &provider, &n, &in, &out, &cr, &cw); err != nil {
			return err
		}
		if pricing.Subscription(provider) {
			continue // spends the owner's subscription limits, not money
		}
		if c := pricing.Cost(model, in, out, cr, cw); c != nil {
			sp.CostUSD += *c
		} else if in+out+cr+cw > 0 {
			sp.Unpriced += n
		}
	}
	return rows.Err()
}

// priceUsers fills each user's last-30-days spending in dollars.
func priceUsers(ctx context.Context, tx pgx.Tx, users []User) error {
	at := map[string]int{}
	for i, u := range users {
		at[u.ID] = i
	}
	rows, err := tx.Query(ctx, `SELECT a.owner_id, a.model, a.provider, coalesce(sum(r.tokens_in), 0), coalesce(sum(r.tokens_out), 0),
			coalesce(sum(r.tokens_cache_read), 0), coalesce(sum(r.tokens_cache_write), 0)
		FROM runs r JOIN agents a ON a.id = r.agent_id WHERE r.created_at > now() - interval '30 days'
		GROUP BY a.owner_id, a.model, a.provider`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var owner, model, provider string
		var in, out, cr, cw int64
		if err := rows.Scan(&owner, &model, &provider, &in, &out, &cr, &cw); err != nil {
			return err
		}
		i, ok := at[owner]
		if c := pricing.Cost(model, in, out, cr, cw); ok && c != nil && !pricing.Subscription(provider) {
			users[i].Cost30d += *c
		}
	}
	return rows.Err()
}

// SettingsPatch changes only the switches it names.
type SettingsPatch struct {
	RunsPaused *bool `json:"runs_paused"`
	UserRuns   *bool `json:"user_runs"`
}

func (s *Service) UpdateSettings(ctx context.Context, p SettingsPatch) (Settings, error) {
	var out Settings
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `UPDATE settings SET runs_paused = coalesce($1, runs_paused), user_runs = coalesce($2, user_runs),
				updated_at = now()
			RETURNING runs_paused, user_runs`, p.RunsPaused, p.UserRuns).Scan(&out.RunsPaused, &out.UserRuns)
	})
	return out, err
}

// SetBlocked blocks or unblocks a user; blocking also cancels their queued and running runs. Admins can't be blocked.
func (s *Service) SetBlocked(ctx context.Context, userID string, blocked bool) error {
	return s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE users SET blocked = $2 WHERE id = $1 AND role <> 'admin'`, userID, blocked)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.StateConflict("Unknown user, or an admin")
		}
		if blocked {
			_, err = tx.Exec(ctx, cancelOpen+` AND agent_id IN (SELECT id FROM agents WHERE owner_id = $1)`, userID)
		}
		return err
	})
}

// cancelOpen marks open runs cancelled; the worker notices and kills their containers.
const cancelOpen = `UPDATE runs SET status = 'infra_error', failure_reason = 'cancelled', finished_at = now(), updated_at = now()
	WHERE status IN ('queued', 'agent', 'checking')`

// CancelAll cancels every queued and running run and returns how many.
func (s *Service) CancelAll(ctx context.Context) (int64, error) {
	var n int64
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, cancelOpen)
		n = tag.RowsAffected()
		return err
	})
	return n, err
}

// RegisterRoutes mounts the admin API (the caller wraps it in RequireSession + RequireAdmin).
func RegisterRoutes(mux *http.ServeMux, s *Service) {
	mux.HandleFunc("GET /api/v1/admin/overview", func(w http.ResponseWriter, r *http.Request) {
		o, err := s.Overview(r.Context())
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, o)
	})
	mux.HandleFunc("PATCH /api/v1/admin/settings", func(w http.ResponseWriter, r *http.Request) {
		raw, err := httpx.ReadBody(w, r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var p SettingsPatch
		if err := httpx.Decode(raw, &p); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := s.UpdateSettings(r.Context(), p)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, out)
	})
	mux.HandleFunc("PUT /api/v1/admin/users/{id}/blocked", func(w http.ResponseWriter, r *http.Request) {
		raw, err := httpx.ReadBody(w, r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var in struct {
			Blocked bool `json:"blocked"`
		}
		if err := httpx.Decode(raw, &in); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := s.SetBlocked(r.Context(), r.PathValue("id"), in.Blocked); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /api/v1/admin/runs/cancel", func(w http.ResponseWriter, r *http.Request) {
		n, err := s.CancelAll(r.Context())
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, map[string]int64{"cancelled": n})
	})
}
