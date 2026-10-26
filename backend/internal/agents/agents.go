// Package agents stores uploaded agents: a zip bundle with run.sh at its root and the LLM key the agent spends.
// The key is sealed at rest and never leaves the server again: the sandboxed agent gets a run token instead, and
// the gateway swaps it for the real key.
package agents

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/admin"
	"tolerance/internal/platform/db"
	"tolerance/internal/platform/httpx"
	"tolerance/internal/platform/idgen"
	"tolerance/internal/platform/secretbox"
	"tolerance/internal/pricing"
	"tolerance/internal/sandbox"
)

const (
	MaxBundleBytes = 20 << 20
	maxFiles       = 2000
	// maxAgentsPerUser caps the agents one non-admin user keeps.
	maxAgentsPerUser = 10
)

type Service struct {
	pool *db.Pool
	box  *secretbox.Box
	// SubscriptionEmail is the one account whose agents may be keyed with a personal Claude / ChatGPT
	// subscription ("" = nobody; ARENA_SUBSCRIPTIONS=true sets the site owner). A subscription is its owner's own:
	// no other user, admins included, may key or run an agent on it (runs.Create checks the second half).
	SubscriptionEmail string
	// CheckKeys asks the provider whether a key works before saving it (off in tests and with a fake gateway).
	CheckKeys bool
}

func NewService(pool *db.Pool, box *secretbox.Box) *Service { return &Service{pool: pool, box: box} }

// Agent is the public face of an agent (no key, no bundle).
type Agent struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Provider    string `json:"provider"`
	// Model is the catalog model a ready agent runs (pricing.Models; empty for an uploaded agent: unknown).
	Model     string `json:"model,omitempty"`
	ModelName string `json:"model_name,omitempty"`
	// Price is the model's list price (nil when the model is unknown; on a subscription key no money is spent).
	Price *pricing.Price `json:"price,omitempty"`
	// Rate is how fast runs on this model spend tokens, per minute of agent work, from finished runs that called it
	// (every agent's, any task): the site multiplies it by a time limit and the price for an estimate. With no run on
	// this model yet it is every model's (AllModels). nil when nothing has run.
	Rate *Rate `json:"rate,omitempty"`
	// SpentUSD is this agent's runs so far at list price (nil when the model is unknown, 0 on a subscription).
	SpentUSD  *float64  `json:"spent_usd,omitempty"`
	KeyHint   string    `json:"key_hint,omitempty"`
	Files     int       `json:"files"`
	Owner     string    `json:"owner"`
	Runs      int       `json:"runs"`
	BestScore *int      `json:"best_score"`
	CreatedAt time.Time `json:"created_at"`
}

// Rate is tokens per minute of agent work, by kind, over Runs finished runs.
type Rate struct {
	In         float64 `json:"in"`
	Out        float64 `json:"out"`
	CacheRead  float64 `json:"cache_read"`
	CacheWrite float64 `json:"cache_write"`
	Runs       int     `json:"runs"`
	AvgMinutes float64 `json:"avg_minutes"` // how long those runs worked, on average (many stop before their limit)
	AllModels  bool    `json:"all_models,omitempty"`
}

func invalid(msg string) error { return httpx.New(http.StatusBadRequest, "invalid_agent", msg) }

// Providers: where the agent's key is spent. The gateway maps each one to the protocols it speaks
// (gateway.providers): orcarouter takes the Anthropic, OpenAI and Gemini protocols with one key. claude-sub and
// chatgpt-sub are personal subscriptions (Service.SubscriptionEmail's agents only).

// sealKey checks the key for the provider and returns what to seal and a short hint. For chatgpt-sub the key is
// Codex's ~/.codex/auth.json: only the access token and the account id are kept. The refresh token is dropped on
// purpose: refreshing it here would log the owner's own Codex out (refresh tokens rotate).
func (s *Service) sealKey(provider, key string, subscriptionOK bool) (sealed []byte, hint string, err error) {
	key = strings.TrimSpace(key)
	switch provider {
	case "anthropic", "openai", "google", "orcarouter":
	case "claude-sub", "chatgpt-sub":
		if !subscriptionOK {
			return nil, "", invalid("Subscriptions are off here: use an API key")
		}
	default:
		return nil, "", invalid("The provider must be anthropic, openai, google or orcarouter")
	}
	if provider == "chatgpt-sub" {
		var auth struct {
			Tokens struct {
				AccessToken string `json:"access_token"`
				AccountID   string `json:"account_id"`
			} `json:"tokens"`
		}
		if json.Unmarshal([]byte(key), &auth) != nil || auth.Tokens.AccessToken == "" || auth.Tokens.AccountID == "" {
			return nil, "", invalid("Paste the whole ~/.codex/auth.json of a Codex signed in with ChatGPT")
		}
		b, _ := json.Marshal(map[string]string{"access_token": auth.Tokens.AccessToken, "account_id": auth.Tokens.AccountID})
		key = string(b)
		hint = "…" + auth.Tokens.AccessToken[len(auth.Tokens.AccessToken)-4:]
	} else {
		if len(key) < 20 || strings.ContainsAny(key, " \n\t") {
			return nil, "", invalid("That doesn't look like an API key")
		}
		if err := keyKind(provider, key); err != nil {
			return nil, "", err
		}
		hint = "…" + key[len(key)-4:]
	}
	sealed, err = s.box.Seal(key)
	return sealed, hint, err
}

// BundleFiles unpacks a bundle into the files for /agent: run.sh must be at the root or inside a single top-level
// folder (which is then stripped). Executable bits are kept.
func BundleFiles(data []byte) (map[string]sandbox.File, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, invalid("The bundle is not a valid zip")
	}
	if len(zr.File) > maxFiles {
		return nil, invalid("The bundle has too many files (max 2000)")
	}
	prefix := ""
	found := false
	for _, f := range zr.File {
		n := strings.TrimPrefix(path.Clean("/"+f.Name), "/")
		if n == "run.sh" {
			prefix, found = "", true
			break
		}
		if strings.Count(n, "/") == 1 && path.Base(n) == "run.sh" && !strings.HasPrefix(n, "__MACOSX") {
			prefix, found = path.Dir(n)+"/", true
		}
	}
	if !found {
		return nil, invalid("The bundle needs run.sh at its root")
	}
	out := map[string]sandbox.File{}
	var total int64
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		n := strings.TrimPrefix(path.Clean("/"+f.Name), "/")
		if !strings.HasPrefix(n, prefix) || strings.HasPrefix(n, "__MACOSX/") || path.Base(n) == ".DS_Store" {
			continue
		}
		n = strings.TrimPrefix(n, prefix)
		if n == "" || strings.HasPrefix(n, "../") {
			continue
		}
		if !f.Mode().IsRegular() {
			continue // symlinks and devices are dropped
		}
		rc, err := f.Open()
		if err != nil {
			return nil, invalid("Cannot read " + n + " from the bundle")
		}
		body, err := io.ReadAll(io.LimitReader(rc, MaxBundleBytes*4+1))
		rc.Close()
		total += int64(len(body))
		if err != nil || total > MaxBundleBytes*4 {
			return nil, invalid("The bundle unpacks to more than 80 MB")
		}
		mode := int64(0o644)
		if f.Mode()&0o111 != 0 || strings.HasSuffix(n, ".sh") {
			mode = 0o755
		}
		out[n] = sandbox.File{Body: body, Mode: mode}
	}
	return out, nil
}

type CreateInput struct {
	Name, Description, Provider, APIKey string
	Model                               string // a pricing.Models slug, or "" (unknown)
	Bundle                              []byte
}

// Create stores a new agent of ownerID; limited is false for admins (no cap on the number of agents).
func (s *Service) Create(ctx context.Context, ownerID string, limited bool, in CreateInput) (Agent, error) {
	in.Name = strings.TrimSpace(in.Name)
	in.Description = strings.TrimSpace(in.Description)
	in.APIKey = strings.TrimSpace(in.APIKey)
	if !httpx.ValidText(in.Name, 2, 60) {
		return Agent{}, invalid("The name must be 2–60 characters")
	}
	if len([]rune(in.Description)) > 500 {
		return Agent{}, invalid("The description is longer than 500 characters")
	}
	sealed, hint, err := s.sealKey(in.Provider, in.APIKey, pricing.Subscription(in.Provider) && s.subscriber(ctx, ownerID))
	if err != nil {
		return Agent{}, err
	}
	if err := s.checkKey(ctx, in.Provider, in.APIKey); err != nil {
		return Agent{}, err
	}
	if !bytes.HasPrefix(in.Bundle, []byte("PK")) {
		// A bare run.sh is a one-file bundle.
		if !bytes.HasPrefix(in.Bundle, []byte("#!")) {
			return Agent{}, invalid("Upload a zip with run.sh at its root, or run.sh itself (starting with #!)")
		}
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		h := &zip.FileHeader{Name: "run.sh", Method: zip.Deflate}
		h.SetMode(0o755)
		w, err := zw.CreateHeader(h)
		if err == nil {
			_, err = w.Write(in.Bundle)
		}
		if err == nil {
			err = zw.Close()
		}
		if err != nil {
			return Agent{}, err
		}
		in.Bundle = buf.Bytes()
	}
	files, err := BundleFiles(in.Bundle)
	if err != nil {
		return Agent{}, err
	}
	id := idgen.New("agent")
	err = s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if limited {
			if err := admin.CanCreate(ctx, tx, ownerID); err != nil {
				return err
			}
			var n int
			if err := tx.QueryRow(ctx, `SELECT count(*) FROM agents WHERE owner_id = $1`, ownerID).Scan(&n); err != nil {
				return err
			}
			if n >= maxAgentsPerUser {
				return httpx.New(http.StatusTooManyRequests, "too_many_agents", "You already have 10 agents: delete one first")
			}
		}
		_, err := tx.Exec(ctx, `INSERT INTO agents (id, owner_id, name, description, bundle, bundle_files, provider, api_key, key_hint, model)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, id, ownerID, in.Name, in.Description, in.Bundle, len(files), in.Provider, sealed, hint, in.Model)
		return err
	})
	if err != nil {
		return Agent{}, err
	}
	return s.Get(ctx, id, true)
}

const agentSelect = `SELECT a.id, a.name, a.description, a.provider, a.model, a.key_hint, a.bundle_files, u.handle, a.created_at,
	(SELECT count(*) FROM runs r WHERE r.agent_id = a.id),
	(SELECT max(score) FROM runs r WHERE r.agent_id = a.id AND r.status = 'done'),
	m.n, m.secs, m.tin, m.tout, m.tcr, m.tcw, g.n, g.secs, g.tin, g.tout, g.tcr, g.tcw, o.tin, o.tout, o.tcr, o.tcw
	FROM agents a JOIN users u ON u.id = a.owner_id
	LEFT JOIN LATERAL (SELECT coalesce(sum(r.tokens_in), 0) AS tin, coalesce(sum(r.tokens_out), 0) AS tout,
			coalesce(sum(r.tokens_cache_read), 0) AS tcr, coalesce(sum(r.tokens_cache_write), 0) AS tcw
		FROM runs r WHERE r.agent_id = a.id) o ON true
	LEFT JOIN LATERAL (` + rateSums + ` AND a.model <> '' AND b.model = a.model) m ON true
	LEFT JOIN LATERAL (` + rateSums + `) g ON true`

// rateSums totals the finished runs that called a model and ran a while (the rows behind Rate).
const rateSums = `SELECT count(*) AS n, sum(r.agent_seconds)::float8 AS secs, sum(r.tokens_in)::float8 AS tin,
		sum(r.tokens_out)::float8 AS tout, sum(r.tokens_cache_read)::float8 AS tcr, sum(r.tokens_cache_write)::float8 AS tcw
	FROM runs r JOIN agents b ON b.id = r.agent_id WHERE r.status = 'done' AND r.llm_requests > 0 AND r.agent_seconds > 0`

// rate turns the sums of rateSums into tokens per minute; nil without runs.
func rate(n int, secs, in, out, cr, cw *float64) *Rate {
	if n == 0 || secs == nil || *secs <= 0 {
		return nil
	}
	m := *secs / 60
	return &Rate{In: *in / m, Out: *out / m, CacheRead: *cr / m, CacheWrite: *cw / m, Runs: n, AvgMinutes: m / float64(n)}
}

func scan(row pgx.Row, withKey bool) (Agent, error) {
	var a Agent
	var mn, gn int
	var ms, mi, mo, mr, mw, gs, gi, gout, gr, gw *float64
	var oi, oo, ocr, ocw int64
	err := row.Scan(&a.ID, &a.Name, &a.Description, &a.Provider, &a.Model, &a.KeyHint, &a.Files, &a.Owner, &a.CreatedAt,
		&a.Runs, &a.BestScore, &mn, &ms, &mi, &mo, &mr, &mw, &gn, &gs, &gi, &gout, &gr, &gw, &oi, &oo, &ocr, &ocw)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, httpx.NotFound()
	}
	a.CreatedAt = a.CreatedAt.UTC()
	if m := pricing.BySlug(a.Model); m != nil {
		a.ModelName = m.Name
		p := m.Price
		a.Price = &p
		a.SpentUSD = pricing.Spent(a.Model, a.Provider, oi, oo, ocr, ocw)
		if a.Rate = rate(mn, ms, mi, mo, mr, mw); a.Rate == nil {
			if a.Rate = rate(gn, gs, gi, gout, gr, gw); a.Rate != nil {
				a.Rate.AllModels = true
			}
		}
	}
	if !withKey {
		a.KeyHint = ""
	}
	return a, err
}

// Get returns one agent; withKey adds the key hint (owner/admin views).
func (s *Service) Get(ctx context.Context, id string, withKey bool) (Agent, error) {
	var a Agent
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		a, err = scan(tx.QueryRow(ctx, agentSelect+` WHERE a.id = $1`, id), withKey)
		return err
	})
	return a, err
}

// List returns the agents of ownerID ("" = everyone's), newest first; withKey adds the key hints.
func (s *Service) List(ctx context.Context, ownerID string, withKey bool) ([]Agent, error) {
	out := []Agent{}
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, agentSelect+` WHERE $1 = '' OR a.owner_id = $1 ORDER BY a.created_at DESC`, ownerID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			a, err := scan(rows, withKey)
			if err != nil {
				return err
			}
			out = append(out, a)
		}
		return rows.Err()
	})
	return out, err
}

// UpdateKey replaces the agent's key (and provider). ownerID "" (an admin) may change any agent.
func (s *Service) UpdateKey(ctx context.Context, ownerID, id, provider, key string) (Agent, error) {
	ok := false
	if pricing.Subscription(provider) {
		// The agent's owner decides, not the caller: an admin can't put their subscription on someone else's agent.
		var agentOwner string
		err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
			return tx.QueryRow(ctx, `SELECT owner_id FROM agents WHERE id = $1 AND ($2 = '' OR owner_id = $2)`, id, ownerID).Scan(&agentOwner)
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return Agent{}, httpx.NotFound()
		}
		if err != nil {
			return Agent{}, err
		}
		ok = s.subscriber(ctx, agentOwner) && (ownerID == "" || ownerID == agentOwner)
	}
	sealed, hint, err := s.sealKey(provider, key, ok)
	if err != nil {
		return Agent{}, err
	}
	if err := s.checkKey(ctx, provider, strings.TrimSpace(key)); err != nil {
		return Agent{}, err
	}
	err = s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		// A ready agent's model must be served at the new key kind too (the worker sets MODEL by it).
		var model string
		if err := tx.QueryRow(ctx, `SELECT model FROM agents WHERE id = $1`, id).Scan(&model); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.NotFound()
			}
			return err
		}
		if m := pricing.BySlug(model); m != nil {
			if _, ok := m.IDs[provider]; !ok {
				return invalid(m.Name + " isn't available with that kind of key")
			}
		}
		tag, err := tx.Exec(ctx, `UPDATE agents SET provider = $2, api_key = $3, key_hint = $4, updated_at = now()
			WHERE id = $1 AND ($5 = '' OR owner_id = $5)`, id, provider, sealed, hint, ownerID)
		if err == nil && tag.RowsAffected() == 0 {
			return httpx.NotFound()
		}
		return err
	})
	if err != nil {
		return Agent{}, err
	}
	return s.Get(ctx, id, true)
}

// Delete removes the agent with all its runs. ownerID "" (an admin) may delete any agent.
func (s *Service) Delete(ctx context.Context, ownerID, id string) error {
	return s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM agents WHERE id = $1 AND ($2 = '' OR owner_id = $2)`, id, ownerID)
		if err == nil && tag.RowsAffected() == 0 {
			return httpx.NotFound()
		}
		return err
	})
}

// subscriber reports whether userID is the account allowed to key agents with a personal subscription.
func (s *Service) subscriber(ctx context.Context, userID string) bool {
	if s.SubscriptionEmail == "" || userID == "" {
		return false
	}
	var email string
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT email FROM users WHERE id = $1`, userID).Scan(&email)
	})
	return err == nil && strings.EqualFold(email, s.SubscriptionEmail)
}
