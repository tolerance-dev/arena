package runs

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"testing"
	"time"

	"tolerance/internal/identity"
	"tolerance/internal/platform/db/dbtest"
	"tolerance/internal/platform/idgen"
	"tolerance/internal/tasks"
)

func TestWeekSlot(t *testing.T) {
	due := time.Date(2026, 10, 26, tournamentHour, 0, 0, 0, time.UTC) // a Monday, ISO week 44
	for _, now := range []time.Time{
		time.Date(2026, 10, 26, 1, 0, 0, 0, time.UTC),
		time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC),
		time.Date(2026, 11, 1, 23, 59, 0, 0, time.UTC),
		time.Date(2026, 11, 2, 1, 0, 0, 0, time.FixedZone("UTC+3", 3*3600)), // Sunday in UTC
	} {
		week, got := weekSlot(now)
		if week != "2026-W44" || !got.Equal(due) {
			t.Errorf("weekSlot(%v) = %s %v, want 2026-W44 %v", now, week, got, due)
		}
	}
}

// owner adds the site owner (ARENA_OWNER_EMAIL, unset in tests) with one ready agent per name.
func (f fixture) owner(names ...string) (string, []string) {
	identity.OwnerEmail = "owner@example.com"
	id := idgen.New("u")
	f.exec(`INSERT INTO users (id, email, handle, role) VALUES ($1, $2, 'owner', 'admin')`, id, identity.OwnerEmail)
	var agents []string
	for _, n := range names {
		a := f.agent(id, n)
		f.exec(`UPDATE agents SET model = 'claude-opus-5.5' WHERE id = $1`, a)
		agents = append(agents, a)
	}
	return id, agents
}

func (f fixture) count(q string, args ...any) int {
	f.t.Helper()
	var n int
	if err := f.pool.Raw().QueryRow(context.Background(), q, args...).Scan(&n); err != nil {
		f.t.Fatalf("%s: %v", q, err)
	}
	return n
}

// The weekly tournament is queued once per week, only after its Monday slot, only if it was on by then, and waits
// while the last one is still going.
func TestScheduleTournament(t *testing.T) {
	pool := dbtest.New(t)
	f := fixture{t, pool}
	ctx := context.Background()
	owner, agents := f.owner("claude-code", "codex")
	f.agent(owner, "uploaded") // no model: not a ready agent, doesn't play
	per := len(agents) * len(tasks.All()) * tournamentRounds

	mon := time.Date(2026, 10, 26, tournamentHour, 0, 0, 0, time.UTC)
	schedule := func(now time.Time) int {
		t.Helper()
		n, err := ScheduleTournament(ctx, pool, now)
		if err != nil {
			t.Fatal(err)
		}
		return n
	}

	// Off: nothing.
	if n := schedule(mon.Add(time.Hour)); n != 0 {
		t.Fatalf("off: queued %d", n)
	}
	// Switched on after this week's slot: this week is skipped, the next one isn't.
	f.exec(`UPDATE settings SET tournament_since = $1`, mon.Add(time.Hour))
	if n := schedule(mon.Add(2 * time.Hour)); n != 0 {
		t.Fatalf("on after the slot: queued %d", n)
	}
	next := mon.AddDate(0, 0, 7)
	if n := schedule(next.Add(-time.Minute)); n != 0 {
		t.Fatalf("before the slot: queued %d", n)
	}
	if n := schedule(next); n != per {
		t.Fatalf("at the slot: queued %d, want %d", n, per)
	}
	if n := schedule(next.Add(time.Hour)); n != 0 {
		t.Fatalf("same week again: queued %d", n)
	}
	if got := f.count(`SELECT count(*) FROM runs WHERE tournament_id IS NOT NULL AND agent_id = ANY($1)`, agents); got != per {
		t.Fatalf("tournament runs of the ready agents: %d, want %d", got, per)
	}

	// The week after, the last one is still going: wait, then go once it ended.
	after := next.AddDate(0, 0, 7)
	if n := schedule(after); n != 0 {
		t.Fatalf("last one still open: queued %d", n)
	}
	f.exec(`UPDATE runs SET status = 'done' WHERE tournament_id IS NOT NULL`)
	if n := schedule(after.Add(2 * time.Hour)); n != per {
		t.Fatalf("after the last one ended: queued %d, want %d", n, per)
	}
	if got := f.count(`SELECT count(*) FROM tournaments`); got != 2 {
		t.Fatalf("tournaments: %d, want 2", got)
	}

	// Off again: nothing more.
	s := NewService(pool, "", 2)
	if err := s.SetTournamentWeekly(ctx, owner, false); err != nil {
		t.Fatal(err)
	}
	f.exec(`UPDATE runs SET status = 'done' WHERE tournament_id IS NOT NULL`)
	if n := schedule(after.AddDate(0, 0, 7)); n != 0 {
		t.Fatalf("switched off: queued %d", n)
	}
}

// Workers that schedule at the same moment queue the week's tournament once.
func TestScheduleTournamentOnce(t *testing.T) {
	pool := dbtest.New(t)
	f := fixture{t, pool}
	_, agents := f.owner("claude-code")
	mon := time.Date(2026, 10, 26, tournamentHour, 0, 0, 0, time.UTC)
	f.exec(`UPDATE settings SET tournament_since = $1`, mon.Add(-time.Hour))

	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := ScheduleTournament(context.Background(), pool, mon.Add(time.Minute))
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	want := len(agents) * len(tasks.All()) * tournamentRounds
	if got := f.count(`SELECT count(*) FROM runs`); got != want {
		t.Fatalf("runs: %d, want %d", got, want)
	}
}

// Only the site owner starts a tournament or switches the weekly one; a new one waits for the last to end.
func TestStartTournament(t *testing.T) {
	pool := dbtest.New(t)
	f := fixture{t, pool}
	ctx := context.Background()
	s := NewService(pool, "", 2)
	other := f.user("admin2", time.Hour)
	f.exec(`UPDATE users SET role = 'admin' WHERE id = $1`, other)

	owner, _ := f.owner()
	if _, err := s.StartTournament(ctx, owner); !errors.Is(err, errNoPlayers) {
		t.Fatalf("no ready agents: %v", err)
	}
	a := f.agent(owner, "claude-code")
	f.exec(`UPDATE agents SET model = 'claude-opus-5.5' WHERE id = $1`, a)

	if _, err := s.StartTournament(ctx, other); !errors.Is(err, errNotOwner) {
		t.Fatalf("another admin started one: %v", err)
	}
	if err := s.SetTournamentWeekly(ctx, other, true); !errors.Is(err, errNotOwner) {
		t.Fatalf("another admin switched the weekly one: %v", err)
	}
	n, err := s.StartTournament(ctx, owner)
	if err != nil || n != len(tasks.All())*tournamentRounds {
		t.Fatalf("start: %d %v", n, err)
	}
	if _, err := s.StartTournament(ctx, owner); !errors.Is(err, errTournamentOpen) {
		t.Fatalf("second while the first is open: %v", err)
	}

	st, err := s.TournamentState(ctx, owner, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if !st.CanManage || st.Weekly || len(st.Players) != 1 || len(st.Recent) != 1 || st.Recent[0].Open != n || st.Recent[0].Week != nil {
		t.Fatalf("state: %+v", st)
	}
	if st, _ := s.TournamentState(ctx, other, time.Now()); st.CanManage {
		t.Fatal("another admin may manage it")
	}
}

// A user who queues a run after a tournament waits for at most one tournament run: the queue goes round-robin
// between owners, and the tournament's runs are the owner's.
func TestTournamentQueueFairness(t *testing.T) {
	pool := dbtest.New(t)
	f := fixture{t, pool}
	ctx := context.Background()
	s := NewService(pool, "", 2)
	owner, _ := f.owner("claude-code", "codex")
	if _, err := s.StartTournament(ctx, owner); err != nil {
		t.Fatal(err)
	}
	mine := f.queued(f.agent(f.user("alice", time.Hour), "a"), time.Now().Add(time.Minute))
	_, spots := positions(t, s)
	if p := spots[mine].position; p > 2 {
		t.Fatalf("the user's run is %d in the queue, want at most 2", p)
	}

	// The worker takes the tournament round by round: the first runs cover every agent at the first task.
	w := NewWorker(pool, slog.Default(), WorkerConfig{Concurrency: 10})
	seen := map[string]bool{}
	for range 4 {
		id, err := w.claim(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if id == mine {
			continue
		}
		var agent, task string
		if err := pool.Raw().QueryRow(ctx, `SELECT agent_id, task FROM runs WHERE id = $1`, id).Scan(&agent, &task); err != nil {
			t.Fatal(err)
		}
		seen[agent+"/"+task] = true
	}
	if len(seen) != 3 {
		t.Fatalf("first tournament runs repeat an agent and task: %v", seen)
	}
}
