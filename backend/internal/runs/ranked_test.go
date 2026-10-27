package runs

import (
	"context"
	"slices"
	"testing"
	"time"

	"tolerance/internal/platform/db/dbtest"
)

// A run that spent more tokens than its budget isn't ranked, by any margin; one that spent exactly its budget is.
func TestOverBudgetRunIsNotRanked(t *testing.T) {
	pool := dbtest.New(t)
	f := fixture{t, pool}
	s := NewService(pool, "", 1)
	owner := f.user("owner", 48*time.Hour)
	over, exact := f.agent(owner, "over"), f.agent(owner, "exact")
	overRun := f.done(over, "marketplace", 90, "a")
	f.exec(`UPDATE runs SET tokens_in = token_budget - 10, tokens_out = 8, tokens_cache_write = 3, tokens_cache_read = 5000000 WHERE id = $1`, overRun)
	exactRun := f.done(exact, "marketplace", 50, "b")
	f.exec(`UPDATE runs SET tokens_in = token_budget - 10, tokens_out = 10, tokens_cache_read = 5000000 WHERE id = $1`, exactRun)

	for name, list := range map[string]func(context.Context, string) ([]Run, error){"leaderboard": s.Leaderboard, "compare": s.Compare} {
		runs, err := list(context.Background(), "marketplace")
		if err != nil {
			t.Fatal(err)
		}
		if len(runs) != 1 || runs[0].ID != exactRun {
			t.Errorf("%s: got %d runs, want only %s", name, len(runs), exactRun)
		}
	}
}

// An agent stands on its median run, not its best: one run more or a lucky one doesn't move it. With an even count
// the lower middle run stands; the spread is over every ranked run.
func TestLeaderboardMedian(t *testing.T) {
	pool := dbtest.New(t)
	f := fixture{t, pool}
	s := NewService(pool, "", 1)
	owner := f.user("owner", 48*time.Hour)
	lucky, steady, even := f.agent(owner, "lucky"), f.agent(owner, "steady"), f.agent(owner, "even")
	f.done(lucky, "marketplace", 95, "a")
	luckyMedian := f.done(lucky, "marketplace", 50, "b")
	f.done(lucky, "marketplace", 40, "c")
	steadyRun := f.done(steady, "marketplace", 60, "d")
	f.done(even, "marketplace", 80, "e")
	evenMedian := f.done(even, "marketplace", 30, "f")

	for name, list := range map[string]func(context.Context, string) ([]Run, error){"leaderboard": s.Leaderboard, "compare": s.Compare} {
		runs, err := list(context.Background(), "marketplace")
		if err != nil {
			t.Fatal(err)
		}
		var got []string
		for _, r := range runs {
			got = append(got, r.ID)
		}
		if want := []string{steadyRun, luckyMedian, evenMedian}; !slices.Equal(got, want) {
			t.Fatalf("%s: %v, want %v", name, got, want)
		}
		if sp := runs[1].Spread; sp == nil || *sp != (Spread{Runs: 3, Min: 40, Max: 95}) {
			t.Errorf("%s: lucky spread %+v", name, sp)
		}
		if sp := runs[0].Spread; sp == nil || *sp != (Spread{Runs: 1, Min: 60, Max: 60}) {
			t.Errorf("%s: steady spread %+v", name, sp)
		}
	}
}
