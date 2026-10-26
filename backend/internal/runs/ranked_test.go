package runs

import (
	"context"
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
