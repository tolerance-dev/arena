// Package agents stores uploaded agents: a zip bundle with run.sh at its root and the LLM key the agent spends.
// The key is sealed at rest and never leaves the server again: the sandboxed agent gets a run token instead, and
// the gateway swaps it for the real key.
package agents

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"dopamine/internal/platform/db"
	"dopamine/internal/platform/httpx"
	"dopamine/internal/platform/idgen"
	"dopamine/internal/platform/secretbox"
	"dopamine/internal/sandbox"
)

const (
	MaxBundleBytes = 20 << 20
	maxFiles       = 2000
)

type Service struct {
	pool *db.Pool
	box  *secretbox.Box
}

func NewService(pool *db.Pool, box *secretbox.Box) *Service { return &Service{pool: pool, box: box} }

// Agent is the public face of an agent (no key, no bundle).
type Agent struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Provider    string    `json:"provider"`
	KeyHint     string    `json:"key_hint,omitempty"`
	Files       int       `json:"files"`
	Owner       string    `json:"owner"`
	Runs        int       `json:"runs"`
	BestScore   *int      `json:"best_score"`
	CreatedAt   time.Time `json:"created_at"`
}

func invalid(msg string) error { return httpx.New(http.StatusBadRequest, "invalid_agent", msg) }

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
	Bundle                              []byte
}

func (s *Service) Create(ctx context.Context, ownerID string, in CreateInput) (Agent, error) {
	in.Name = strings.TrimSpace(in.Name)
	in.Description = strings.TrimSpace(in.Description)
	in.APIKey = strings.TrimSpace(in.APIKey)
	if !httpx.ValidText(in.Name, 2, 60) {
		return Agent{}, invalid("The name must be 2–60 characters")
	}
	if len([]rune(in.Description)) > 500 {
		return Agent{}, invalid("The description is longer than 500 characters")
	}
	if in.Provider != "anthropic" && in.Provider != "openai" {
		return Agent{}, invalid("The provider must be anthropic or openai")
	}
	if len(in.APIKey) < 20 || strings.ContainsAny(in.APIKey, " \n\t") {
		return Agent{}, invalid("That doesn't look like an API key")
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
	sealed, err := s.box.Seal(in.APIKey)
	if err != nil {
		return Agent{}, err
	}
	id := idgen.New("agent")
	hint := "…" + in.APIKey[len(in.APIKey)-4:]
	err = s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO agents (id, owner_id, name, description, bundle, bundle_files, provider, api_key, key_hint)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, id, ownerID, in.Name, in.Description, in.Bundle, len(files), in.Provider, sealed, hint)
		return err
	})
	if err != nil {
		return Agent{}, err
	}
	return s.Get(ctx, id, true)
}

const agentSelect = `SELECT a.id, a.name, a.description, a.provider, a.key_hint, a.bundle_files, u.handle, a.created_at,
	(SELECT count(*) FROM runs r WHERE r.agent_id = a.id),
	(SELECT max(score) FROM runs r WHERE r.agent_id = a.id AND r.status = 'done')
	FROM agents a JOIN users u ON u.id = a.owner_id`

func scan(row pgx.Row, withKey bool) (Agent, error) {
	var a Agent
	err := row.Scan(&a.ID, &a.Name, &a.Description, &a.Provider, &a.KeyHint, &a.Files, &a.Owner, &a.CreatedAt, &a.Runs, &a.BestScore)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, httpx.NotFound()
	}
	a.CreatedAt = a.CreatedAt.UTC()
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

func (s *Service) List(ctx context.Context, withKey bool) ([]Agent, error) {
	out := []Agent{}
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, agentSelect+` ORDER BY a.created_at DESC`)
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

// UpdateKey replaces the agent's key (and provider).
func (s *Service) UpdateKey(ctx context.Context, id, provider, key string) (Agent, error) {
	key = strings.TrimSpace(key)
	if provider != "anthropic" && provider != "openai" {
		return Agent{}, invalid("The provider must be anthropic or openai")
	}
	if len(key) < 20 || strings.ContainsAny(key, " \n\t") {
		return Agent{}, invalid("That doesn't look like an API key")
	}
	sealed, err := s.box.Seal(key)
	if err != nil {
		return Agent{}, err
	}
	err = s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE agents SET provider = $2, api_key = $3, key_hint = $4, updated_at = now() WHERE id = $1`,
			id, provider, sealed, "…"+key[len(key)-4:])
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

// Delete removes the agent with all its runs.
func (s *Service) Delete(ctx context.Context, id string) error {
	return s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM agents WHERE id = $1`, id)
		if err == nil && tag.RowsAffected() == 0 {
			return httpx.NotFound()
		}
		return err
	})
}

// Bundle returns the stored zip.
func (s *Service) Bundle(ctx context.Context, id string) ([]byte, error) {
	var b []byte
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT bundle FROM agents WHERE id = $1`, id).Scan(&b)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.NotFound()
	}
	return b, err
}
