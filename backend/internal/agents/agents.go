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
	// Subscriptions lets admins use their personal Claude / ChatGPT subscriptions as an agent's key
	// (ARENA_SUBSCRIPTIONS=true, local only: a subscription is for its owner's own use, never a public arena).
	Subscriptions bool
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
	// TypicalCostUSD is the average finished run on this model that called it (every agent's, any task) at list
	// price; TypicalRuns how many runs that average is over.
	TypicalCostUSD *float64  `json:"typical_cost_usd,omitempty"`
	TypicalRuns    int       `json:"typical_runs,omitempty"`
	KeyHint        string    `json:"key_hint,omitempty"`
	Files          int       `json:"files"`
	Owner          string    `json:"owner"`
	Runs           int       `json:"runs"`
	BestScore      *int      `json:"best_score"`
	CreatedAt      time.Time `json:"created_at"`
}

func invalid(msg string) error { return httpx.New(http.StatusBadRequest, "invalid_agent", msg) }

// Providers: where the agent's key is spent. The gateway maps each one to the protocols it speaks
// (gateway.providers): orcarouter takes the Anthropic, OpenAI and Gemini protocols with one key. claude-sub and
// chatgpt-sub are personal subscriptions (admins only, with Service.Subscriptions on).

// sealKey checks the key for the provider and returns what to seal and a short hint. For chatgpt-sub the key is
// Codex's ~/.codex/auth.json: only the access token and the account id are kept. The refresh token is dropped on
// purpose: refreshing it here would log the owner's own Codex out (refresh tokens rotate).
func (s *Service) sealKey(provider, key string, admin bool) (sealed []byte, hint string, err error) {
	key = strings.TrimSpace(key)
	switch provider {
	case "anthropic", "openai", "google", "orcarouter":
	case "claude-sub", "chatgpt-sub":
		if !s.Subscriptions || !admin {
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
	sealed, hint, err := s.sealKey(in.Provider, in.APIKey, !limited)
	if err != nil {
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
	t.n, t.tin, t.tout, t.tcr, t.tcw
	FROM agents a JOIN users u ON u.id = a.owner_id
	LEFT JOIN LATERAL (SELECT count(*) AS n, avg(r.tokens_in)::float8 AS tin, avg(r.tokens_out)::float8 AS tout,
			avg(r.tokens_cache_read)::float8 AS tcr, avg(r.tokens_cache_write)::float8 AS tcw
		FROM runs r JOIN agents b ON b.id = r.agent_id WHERE a.model <> '' AND b.model = a.model AND r.status = 'done' AND r.llm_requests > 0) t ON true`

func scan(row pgx.Row, withKey bool) (Agent, error) {
	var a Agent
	var n int
	var tin, tout, tcr, tcw *float64
	err := row.Scan(&a.ID, &a.Name, &a.Description, &a.Provider, &a.Model, &a.KeyHint, &a.Files, &a.Owner, &a.CreatedAt,
		&a.Runs, &a.BestScore, &n, &tin, &tout, &tcr, &tcw)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, httpx.NotFound()
	}
	a.CreatedAt = a.CreatedAt.UTC()
	if m := pricing.BySlug(a.Model); m != nil {
		a.ModelName = m.Name
		p := m.Price
		a.Price = &p
		if n > 0 && tin != nil {
			a.TypicalCostUSD = pricing.Cost(a.Model, int64(*tin), int64(*tout), int64(*tcr), int64(*tcw))
			a.TypicalRuns = n
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
	sealed, hint, err := s.sealKey(provider, key, ownerID == "")
	if err != nil {
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
