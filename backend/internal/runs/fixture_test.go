package runs

import (
	"context"
	"os"
	"testing"
	"time"

	"tolerance/internal/platform/db"
	"tolerance/internal/platform/idgen"
	"tolerance/internal/tasks"
)

func TestMain(m *testing.M) {
	if err := tasks.Load(""); err != nil {
		panic(err)
	}
	os.Exit(m.Run())
}

// fixture writes rows straight into a test database.
type fixture struct {
	t    *testing.T
	pool *db.Pool
}

func (f fixture) exec(q string, args ...any) {
	f.t.Helper()
	if _, err := f.pool.Raw().Exec(context.Background(), q, args...); err != nil {
		f.t.Fatalf("%s: %v", q, err)
	}
}

// user adds a user whose account is age old.
func (f fixture) user(handle string, age time.Duration) string {
	id := idgen.New("u")
	f.exec(`INSERT INTO users (id, email, handle, created_at) VALUES ($1, $2, $3, $4)`,
		id, handle+"@example.com", handle, time.Now().Add(-age))
	return id
}

func (f fixture) agent(owner, name string) string {
	id := idgen.New("ag")
	f.exec(`INSERT INTO agents (id, owner_id, name, bundle, provider, api_key) VALUES ($1, $2, $3, '\x00', 'anthropic', '\x00')`,
		id, owner, name)
	return id
}

// queued adds a queued run created at.
func (f fixture) queued(agent string, at time.Time) string {
	id := idgen.New("run")
	f.exec(`INSERT INTO runs (id, agent_id, task, time_limit_s, token_budget, manifest, created_at)
		VALUES ($1, $2, 'marketplace', 1800, 1000000, '{"provider": "anthropic"}', $3)`, id, agent, at)
	return id
}

// running adds a run the worker took at started.
func (f fixture) running(agent string, started time.Time) string {
	id := f.queued(agent, started.Add(-time.Minute))
	f.exec(`UPDATE runs SET status = 'agent', started_at = $2 WHERE id = $1`, id, started)
	return id
}

// done adds a finished run at task whose app started, with shot as its screenshot.
func (f fixture) done(agent, task string, score int, shot string) string {
	t := tasks.BySlug(task)
	if t == nil {
		f.t.Fatalf("no task %q", task)
	}
	id := idgen.New("run")
	f.exec(`INSERT INTO runs (id, agent_id, task, status, time_limit_s, token_budget, score, app_started, shot, started_at, finished_at,
			manifest, checks_version)
		VALUES ($1, $2, $3, 'done', $4, $5, $6, true, $7, now() - interval '20 minutes', now(), $8, $9)`,
		id, agent, task, t.TimeLimitS, t.TokenBudget, score, []byte(shot), newManifest(t, "anthropic", "", ""), checksVersion(t))
	return id
}
