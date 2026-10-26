package runs

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"tolerance/internal/platform/db/dbtest"
	"tolerance/internal/platform/httpx"
)

type contender struct{ agent, run, shot string }

// Pairs carry nothing that names a run or an agent, each alias serves its own side's shot, only the voter votes with
// their pair, and a vote for side "a" counts for the agent behind alias a, whatever order the pair is stored in.
func TestVoteBlind(t *testing.T) {
	pool := dbtest.New(t)
	f := fixture{t, pool}
	s := NewService(pool, "http://{id}.preview.test", 1)
	ctx := context.Background()

	voter := f.user("voter", 48*time.Hour)
	other := f.user("other", 48*time.Hour)
	var all []contender
	for _, name := range []string{"red", "green", "blue"} {
		ag := f.agent(f.user("owner-"+name, 48*time.Hour), "agent-"+name)
		all = append(all, contender{ag, f.done(ag, "marketplace", 50, "shot-"+name), "shot-" + name})
	}
	own := f.agent(voter, "agent-own")
	ownRun := f.done(own, "marketplace", 90, "shot-own")
	byShot := map[string]contender{}
	for _, c := range all {
		byShot[c.shot] = c
	}

	for left := 3; left > 0; left-- {
		p, err := s.NextPair(ctx, voter, "marketplace")
		if err != nil {
			t.Fatal(err)
		}
		if p == nil {
			t.Fatalf("no pair with %d left", left)
		}
		if p.Left != left {
			t.Errorf("left = %d, want %d", p.Left, left)
		}
		body, _ := json.Marshal(p)
		for _, c := range append(all, contender{own, ownRun, ""}) {
			for _, secret := range []string{c.run, PreviewHost(c.run), c.agent, "agent-", "owner-"} {
				if strings.Contains(string(body), secret) {
					t.Fatalf("pair leaks %q: %s", secret, body)
				}
			}
		}

		side := func(alias string) contender {
			t.Helper()
			shot, err := s.VoteShot(ctx, alias, "shot")
			if err != nil {
				t.Fatalf("shot of %s: %v", alias, err)
			}
			c, ok := byShot[string(shot)]
			if !ok {
				t.Fatalf("alias %s serves %q: the voter's own agent or an unknown run", alias, shot)
			}
			return c
		}
		a, b := side(p.A.Alias), side(p.B.Alias)
		if _, err := s.Vote(ctx, other, p.ID, "b"); !isStatus(err, http.StatusConflict) {
			t.Fatalf("another user voted with the voter's pair: %v", err)
		}

		before, err := s.Ratings(ctx, "marketplace")
		if err != nil {
			t.Fatal(err)
		}
		reveal, err := s.Vote(ctx, voter, p.ID, "a")
		if err != nil {
			t.Fatal(err)
		}
		if reveal.A.ID != a.agent || reveal.B.ID != b.agent {
			t.Fatalf("reveal names %s vs %s, the shots were %s vs %s", reveal.A.ID, reveal.B.ID, a.agent, b.agent)
		}
		after, err := s.Ratings(ctx, "marketplace")
		if err != nil {
			t.Fatal(err)
		}
		if after[a.agent].Wins != before[a.agent].Wins+1 || after[b.agent].Losses != before[b.agent].Losses+1 {
			t.Fatalf("a vote for side a did not count for the agent shown as a")
		}
		if _, err := s.Vote(ctx, voter, p.ID, "a"); !isStatus(err, http.StatusConflict) {
			t.Fatalf("voted twice with one pair: %v", err)
		}
	}
	if p, err := s.NextPair(ctx, voter, "marketplace"); err != nil || p != nil {
		t.Fatalf("pair after every pair was voted on: %+v, %v", p, err)
	}
}

// A guest's pair is voted on by whoever signs in with it, once, and never on their own agent.
func TestVoteGuestPair(t *testing.T) {
	pool := dbtest.New(t)
	f := fixture{t, pool}
	s := NewService(pool, "", 1)
	ctx := context.Background()

	owner := f.user("owner", 48*time.Hour)
	f.done(f.agent(owner, "x"), "marketplace", 50, "x")
	f.done(f.agent(owner, "y"), "marketplace", 50, "y")
	voter := f.user("voter", 48*time.Hour)

	guest := func() *Pair {
		t.Helper()
		p, err := s.NextPair(ctx, "", "marketplace")
		if err != nil || p == nil {
			t.Fatalf("guest pair: %+v, %v", p, err)
		}
		return p
	}
	if _, err := s.Vote(ctx, owner, guest().ID, "a"); err == nil {
		t.Fatal("the owner voted on their own agents through a guest pair")
	}
	p := guest()
	if _, err := s.Vote(ctx, voter, p.ID, "tie"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Vote(ctx, voter, guest().ID, "a"); !isStatus(err, http.StatusConflict) {
		t.Fatalf("voted twice on one pair through a second guest pair: %v", err)
	}
}

// Elo moves 16 points between equals on one vote; votes of blocked accounts never count, of accounts under a day old
// not yet, and a settled account's first-day votes do.
func TestRatings(t *testing.T) {
	pool := dbtest.New(t)
	f := fixture{t, pool}
	s := NewService(pool, "", 1)
	ctx := context.Background()

	x := f.agent(f.user("ox", 48*time.Hour), "x")
	y := f.agent(f.user("oy", 48*time.Hour), "y")
	rx, ry := f.done(x, "marketplace", 50, "x"), f.done(y, "marketplace", 50, "y")
	a, b, winX, winY := rx, ry, "a", "b"
	if a > b {
		a, b, winX, winY = ry, rx, "b", "a"
	}
	vote := func(user, winner string) {
		f.exec(`INSERT INTO pair_votes (user_id, task, run_a, run_b, winner) VALUES ($1, 'marketplace', $2, $3, $4)`, user, a, b, winner)
	}
	vote(f.user("fresh", time.Hour), winY)
	blocked := f.user("blocked", 48*time.Hour)
	f.exec(`UPDATE users SET blocked = true WHERE id = $1`, blocked)
	vote(blocked, winY)
	vote(f.user("judge", 48*time.Hour), winX)
	// Cast in the account's first hour, two days ago: the account is a day old now, so it counts (and counts first).
	settled := f.user("settled", 48*time.Hour)
	f.exec(`INSERT INTO pair_votes (user_id, task, run_a, run_b, winner, created_at) VALUES ($1, 'marketplace', $2, $3, $4, now() - interval '47 hours')`,
		settled, a, b, winX)

	r, err := s.Ratings(ctx, "marketplace")
	if err != nil {
		t.Fatal(err)
	}
	// 1000 → 1016 on the first win, then +14.5 against a 984 (expected score 0.546).
	if got := r[x]; got.Elo != 1031 || got.Votes != 2 || got.Wins != 2 {
		t.Errorf("winner: %+v, want elo 1031 after two counted wins", got)
	}
	if got := r[y]; got.Elo != 969 || got.Votes != 2 || got.Losses != 2 {
		t.Errorf("loser: %+v, want elo 969 after two counted losses", got)
	}
}

func isStatus(err error, status int) bool {
	var p *httpx.Problem
	return errors.As(err, &p) && p.Status == status
}
