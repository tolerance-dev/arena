package runs

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"

	"tolerance/internal/platform/db"
	"tolerance/internal/platform/db/dbtest"
	"tolerance/internal/platform/httpx"
	"tolerance/internal/platform/idgen"
)

type quotaFixture struct {
	t     *testing.T
	pool  *db.Pool
	s     *Service
	user  string
	agent string
}

func newQuotaFixture(t *testing.T) *quotaFixture {
	pool := dbtest.New(t)
	f := &quotaFixture{t: t, pool: pool, s: NewService(pool, "", 1), user: idgen.New("usr")}
	f.sql(`INSERT INTO users (id, email, handle) VALUES ($1, $1 || '@example.com', $1)`, f.user)
	f.agent = f.newAgent()
	return f
}

func (f *quotaFixture) newAgent() string {
	id := idgen.New("agt")
	f.sql(`INSERT INTO agents (id, owner_id, name, bundle, provider, api_key) VALUES ($1, $2, 'a', '', 'openai', '')`, id, f.user)
	return id
}

func (f *quotaFixture) sql(q string, args ...any) {
	f.t.Helper()
	if _, err := f.pool.Raw().Exec(context.Background(), q, args...); err != nil {
		f.t.Fatal(err)
	}
}

func (f *quotaFixture) count(q string, args ...any) int {
	f.t.Helper()
	var n int
	if err := f.pool.Raw().QueryRow(context.Background(), q, args...).Scan(&n); err != nil {
		f.t.Fatal(err)
	}
	return n
}

func (f *quotaFixture) create(owner string) (Run, error) {
	return f.s.Create(context.Background(), owner, f.agent, "marketplace", 0, 0)
}

// startDone creates n runs one by one and finishes each, so only the daily limit is in play.
func (f *quotaFixture) startDone(n int) []string {
	f.t.Helper()
	var ids []string
	for i := 0; i < n; i++ {
		r, err := f.create(f.user)
		if err != nil {
			f.t.Fatalf("run %d: %v", i+1, err)
		}
		f.sql(`UPDATE runs SET status = 'done' WHERE id = $1`, r.ID)
		ids = append(ids, r.ID)
	}
	return ids
}

func isTooMany(err error) bool {
	var p *httpx.Problem
	return errors.As(err, &p) && p.Status == http.StatusTooManyRequests
}

func TestQuotaSurvivesDeletes(t *testing.T) {
	f := newQuotaFixture(t)
	ids := f.startDone(maxDailyRunsPerUser)
	if _, err := f.create(f.user); !isTooMany(err) {
		t.Fatalf("run over the daily limit: got %v, want 429", err)
	}
	if err := f.s.Delete(context.Background(), f.user, ids[0]); err != nil {
		t.Fatal(err)
	}
	if _, err := f.create(f.user); !isTooMany(err) {
		t.Fatalf("after deleting a run: got %v, want 429", err)
	}
	f.sql(`DELETE FROM agents WHERE id = $1`, f.agent)
	f.agent = f.newAgent()
	if _, err := f.create(f.user); !isTooMany(err) {
		t.Fatalf("after deleting the agent: got %v, want 429", err)
	}
	// Account deletion still works and takes the quota rows with it.
	f.sql(`DELETE FROM users WHERE id = $1`, f.user)
	if n := f.count(`SELECT count(*) FROM run_quota`); n != 0 {
		t.Fatalf("run_quota rows after account deletion: %d", n)
	}
}

func TestQuotaRefusalLeavesNoRow(t *testing.T) {
	f := newQuotaFixture(t)
	f.startDone(maxDailyRunsPerUser)
	if _, err := f.create(f.user); !isTooMany(err) {
		t.Fatalf("got %v, want 429", err)
	}
	if _, err := f.s.Create(context.Background(), f.user, "agt_unknown", "marketplace", 0, 0); err == nil {
		t.Fatal("unknown agent accepted")
	}
	if n := f.count(`SELECT count(*) FROM runs`); n != maxDailyRunsPerUser {
		t.Fatalf("runs: %d, want %d", n, maxDailyRunsPerUser)
	}
	if n := f.count(`SELECT count(*) FROM run_quota`); n != maxDailyRunsPerUser {
		t.Fatalf("run_quota rows: %d, want %d", n, maxDailyRunsPerUser)
	}
}

func TestQuotaWindow(t *testing.T) {
	f := newQuotaFixture(t)
	f.startDone(maxDailyRunsPerUser)
	f.sql(`UPDATE run_quota SET created_at = now() - interval '1 day' + interval '1 minute'`)
	if _, err := f.create(f.user); !isTooMany(err) {
		t.Fatalf("runs 23h59m old still count: got %v, want 429", err)
	}
	f.sql(`UPDATE run_quota SET created_at = now() - interval '1 day'`)
	if _, err := f.create(f.user); err != nil {
		t.Fatalf("runs 24h old no longer count: %v", err)
	}
}

func TestQuotaRefunds(t *testing.T) {
	f := newQuotaFixture(t)
	ids := f.startDone(maxDailyRunsPerUser - 1)
	ctx := context.Background()
	// A user's cancel keeps the quota spent.
	r, err := f.create(f.user)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.s.Cancel(ctx, f.user, r.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.create(f.user); !isTooMany(err) {
		t.Fatalf("after a cancel: got %v, want 429", err)
	}
	// The worker's infra_error gives it back.
	f.sql(`UPDATE runs SET status = 'agent' WHERE id = $1`, ids[0])
	if n := f.count(refundQuota(`UPDATE runs SET status = 'infra_error', failure_reason = 'boom' WHERE id = $1 RETURNING id`), ids[0]); n != 1 {
		t.Fatalf("refundQuota changed %d runs, want 1", n)
	}
	if _, err := f.create(f.user); err != nil {
		t.Fatalf("after an infra_error: %v", err)
	}
}

func TestQuotaAdminExempt(t *testing.T) {
	f := newQuotaFixture(t)
	f.startDone(maxDailyRunsPerUser)
	for i := 0; i < maxOpenRunsPerUser+1; i++ {
		if _, err := f.create(""); err != nil {
			t.Fatalf("admin run %d: %v", i+1, err)
		}
	}
	if n := f.count(`SELECT count(*) FROM run_quota`); n != maxDailyRunsPerUser {
		t.Fatalf("admin runs were counted: %d quota rows", n)
	}
}

// parallel starts n creates at once and returns how many were accepted; any error but a 429 fails the test.
func (f *quotaFixture) parallel(n int) int {
	f.t.Helper()
	var wg sync.WaitGroup
	errs := make([]error, n)
	start := make(chan struct{})
	for i := range errs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, errs[i] = f.create(f.user)
		}()
	}
	close(start)
	wg.Wait()
	ok := 0
	for _, err := range errs {
		switch {
		case err == nil:
			ok++
		case !isTooMany(err):
			f.t.Fatalf("unexpected error: %v", err)
		}
	}
	return ok
}

func TestQuotaParallelOpen(t *testing.T) {
	f := newQuotaFixture(t)
	if ok := f.parallel(12); ok != maxOpenRunsPerUser {
		t.Fatalf("%d parallel runs accepted, want %d", ok, maxOpenRunsPerUser)
	}
	if n := f.count(`SELECT count(*) FROM run_quota`); n != maxOpenRunsPerUser {
		t.Fatalf("run_quota rows: %d", n)
	}
}

func TestQuotaParallelDaily(t *testing.T) {
	f := newQuotaFixture(t)
	f.startDone(maxDailyRunsPerUser - 2)
	if ok := f.parallel(12); ok != 2 {
		t.Fatalf("%d parallel runs accepted, want 2", ok)
	}
	if n := f.count(`SELECT count(*) FROM run_quota`); n != maxDailyRunsPerUser {
		t.Fatalf("run_quota rows: %d, want %d", n, maxDailyRunsPerUser)
	}
}
