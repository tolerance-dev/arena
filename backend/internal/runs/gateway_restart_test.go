package runs

import (
	"context"
	"testing"
	"time"

	"tolerance/internal/platform/db/dbtest"
)

// A gateway restart marks only the runs whose agent is working and has no mark yet; only an agent that then crashed
// is the platform's failure.
func TestGatewayRestart(t *testing.T) {
	pool := dbtest.New(t)
	f := fixture{t, pool}
	ag := f.agent(f.user("u", 48*time.Hour), "a")
	now := time.Now()
	working := f.running(ag, now)
	budget := f.running(ag, now)
	f.exec(`UPDATE runs SET agent_exit = 'budget' WHERE id = $1`, budget)
	queued := f.queued(ag, now)
	checking := f.running(ag, now)
	f.exec(`UPDATE runs SET status = 'checking', agent_exit = 'error:1' WHERE id = $1`, checking)

	n, err := MarkGatewayRestart(context.Background(), pool)
	if err != nil || n != 1 {
		t.Fatalf("MarkGatewayRestart = %d, %v; want 1 run", n, err)
	}
	want := map[string]string{working: gatewayRestartMark, budget: "budget", queued: "", checking: "error:1"}
	for id, mark := range want {
		var got string
		if err := pool.Raw().QueryRow(context.Background(), `SELECT coalesce(agent_exit, '') FROM runs WHERE id = $1`, id).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != mark {
			t.Errorf("run %s: agent_exit %q, want %q", id, got, mark)
		}
	}

	for _, c := range []struct {
		mark, exit string
		cut        bool
	}{
		{gatewayRestartMark, "error:1", true},
		{gatewayRestartMark, "ok", false},
		{gatewayRestartMark, "timeout", false},
		{gatewayRestartMark, "budget", false},
		{"", "error:1", false},
		{"budget", "error:1", false},
	} {
		if got := cutByGateway(c.mark, c.exit); got != c.cut {
			t.Errorf("cutByGateway(%q, %q) = %v, want %v", c.mark, c.exit, got, c.cut)
		}
	}
}
