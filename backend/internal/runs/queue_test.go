package runs

import (
	"context"
	"log/slog"
	"slices"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/platform/db/dbtest"
)

// positions lists the queued runs by their queue_position.
func positions(t *testing.T, s *Service) ([]string, map[string]queueSpot) {
	t.Helper()
	var spots map[string]queueSpot
	err := s.pool.Tx(context.Background(), func(ctx context.Context, tx pgx.Tx) error {
		var err error
		spots, err = queueSpots(ctx, tx, s.Slots)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 0, len(spots))
	for id := range spots {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return spots[ids[i]].position < spots[ids[j]].position })
	return ids, spots
}

// The queue goes round-robin between owners, and the run shown at position 1 is the one the worker takes next.
func TestQueueOrder(t *testing.T) {
	pool := dbtest.New(t)
	f := fixture{t, pool}
	s := NewService(pool, "", 2)
	w := NewWorker(pool, slog.Default(), WorkerConfig{Concurrency: 10})
	ctx := context.Background()

	alice := f.agent(f.user("alice", time.Hour), "a")
	bob := f.agent(f.user("bob", time.Hour), "b")
	carol := f.agent(f.user("carol", time.Hour), "c")
	t0 := time.Now().Add(-time.Hour)
	f.running(carol, t0.Add(-10*time.Minute))
	a1 := f.queued(alice, t0)
	a2 := f.queued(alice, t0.Add(time.Second))
	a3 := f.queued(alice, t0.Add(2*time.Second))
	c1 := f.queued(carol, t0.Add(3*time.Second))
	b1 := f.queued(bob, t0.Add(4*time.Second))

	// Alice queued three first, but Bob's only run comes second; Carol already has one running, so her next one
	// waits a turn, and goes before Alice's second only once Alice has been served more recently.
	got, spots := positions(t, s)
	if want := []string{a1, b1, a2, c1, a3}; !slices.Equal(got, want) {
		t.Fatalf("queue order:\n got %v\nwant %v", got, want)
	}
	for _, id := range got {
		if spots[id].waitS == nil {
			t.Fatalf("run %s has no wait estimate while the queue runs", id)
		}
	}

	var claimed []string
	for {
		head, _ := positions(t, s)
		id, err := w.claim(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if id == "" {
			if len(head) > 0 {
				t.Fatalf("worker took nothing while %d runs were queued", len(head))
			}
			break
		}
		if id != head[0] {
			t.Fatalf("worker took %s, but position 1 was %s", id, head[0])
		}
		claimed = append(claimed, id)
	}
	if want := []string{a1, b1, c1, a2, a3}; !slices.Equal(claimed, want) {
		t.Fatalf("claim order:\n got %v\nwant %v", claimed, want)
	}
}

func TestQueuePaused(t *testing.T) {
	pool := dbtest.New(t)
	f := fixture{t, pool}
	s := NewService(pool, "", 1)
	w := NewWorker(pool, slog.Default(), WorkerConfig{})
	run := f.queued(f.agent(f.user("alice", time.Hour), "a"), time.Now())
	f.exec(`UPDATE settings SET runs_paused = true`)

	if id, err := w.claim(context.Background()); err != nil || id != "" {
		t.Fatalf("paused queue: claimed %q, %v", id, err)
	}
	_, spots := positions(t, s)
	if sp := spots[run]; sp.position != 1 || sp.waitS != nil {
		t.Fatalf("paused queue: position %d, wait %v; want 1 and no estimate", sp.position, sp.waitS)
	}
}
