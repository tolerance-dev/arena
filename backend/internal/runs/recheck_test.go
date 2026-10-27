package runs

import (
	"context"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"tolerance/internal/platform/db/dbtest"
	"tolerance/internal/tasks"
)

// A recheck needs the kept snapshot, runs once at a time, and the worker takes it straight to checking: the agent
// doesn't run again (no tokens) and its start time stays.
func TestRecheck(t *testing.T) {
	pool := dbtest.New(t)
	f := fixture{t, pool}
	s := NewService(pool, "", 1)
	w := NewWorker(pool, slog.Default(), WorkerConfig{Concurrency: 1})
	ctx := context.Background()

	id := f.done(f.agent(f.user("owner", 48*time.Hour), "x"), "marketplace", 40, "shot")
	if err := s.Recheck(ctx, id); !isStatus(err, http.StatusConflict) {
		t.Fatalf("rechecked a run without a snapshot: %v", err)
	}
	f.exec(`UPDATE runs SET image = $2, agent_exit = 'ok' WHERE id = $1`, id, ImageFor(id))
	var started time.Time
	if err := pool.Raw().QueryRow(ctx, `SELECT started_at FROM runs WHERE id = $1`, id).Scan(&started); err != nil {
		t.Fatal(err)
	}
	if err := s.Recheck(ctx, id); err != nil {
		t.Fatal(err)
	}
	if err := s.Recheck(ctx, id); !isStatus(err, http.StatusConflict) {
		t.Fatalf("rechecked a run twice at once: %v", err)
	}

	got, err := w.claim(ctx)
	if err != nil || got != id {
		t.Fatalf("claim = %q, %v; want %s", got, err, id)
	}
	var status string
	var restarted time.Time
	var rechecks int
	if err := pool.Raw().QueryRow(ctx, `SELECT status, started_at, rechecks FROM runs WHERE id = $1`, id).Scan(&status, &restarted, &rechecks); err != nil {
		t.Fatal(err)
	}
	if status != "checking" || !restarted.Equal(started) || rechecks != 1 {
		t.Fatalf("claimed recheck: status %s, started %v (was %v), rechecks %d", status, restarted, started, rechecks)
	}
}

// Rechecking everything takes only the runs the current checks would rank, built from the current brief, that kept
// their snapshot; and the rechecks of a user's runs don't hold the user's own runs back.
func TestRecheckStale(t *testing.T) {
	f := newQuotaFixture(t)
	ctx := context.Background()
	f.sql(`UPDATE settings SET user_queue_cap = 1, daily_runs_per_user = 100`)
	var stale []string
	for i := 0; i < maxOpenRunsPerUser; i++ {
		stale = append(stale, f.startDone(1)[0])
	}
	current, gone, long, brief := f.startDone(1)[0], f.startDone(1)[0], f.startDone(1)[0], f.startDone(1)[0]
	f.sql(`UPDATE runs SET image = 'img', agent_exit = 'ok', checks_version = 'old' WHERE id <> $1`, gone)
	f.sql(`UPDATE runs SET checks_version = $2 WHERE id = $1`, current, checksVersion(tasks.BySlug("marketplace")))
	f.sql(`UPDATE runs SET time_limit_s = time_limit_s + 60 WHERE id = $1`, long)
	f.sql(`UPDATE runs SET manifest = manifest || '{"task_md_sha256": "older"}' WHERE id = $1`, brief)

	st, err := f.s.RecheckState(ctx)
	if err != nil || st.Stale != len(stale) || st.Queued != 0 {
		t.Fatalf("before: %+v, %v; want %d stale", st, err, len(stale))
	}
	n, err := f.s.RecheckStale(ctx)
	if err != nil || n != len(stale) {
		t.Fatalf("queued %d, %v; want %d", n, err, len(stale))
	}
	if q := f.count(`SELECT count(*) FROM runs WHERE status = 'queued' AND recheck AND id = ANY($1)`, stale); q != len(stale) {
		t.Fatalf("%d of the stale runs queued", q)
	}
	if st, _ := f.s.RecheckState(ctx); st.Stale != 0 || st.Queued != len(stale) {
		t.Fatalf("after: %+v", st)
	}
	if _, err := f.create(f.user); err != nil {
		t.Fatalf("the user's rechecks held their run back: %v", err)
	}
}
