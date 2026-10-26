package runs

import (
	"context"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"tolerance/internal/platform/db/dbtest"
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
