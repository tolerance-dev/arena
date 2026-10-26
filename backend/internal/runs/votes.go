package runs

import (
	"context"
	"math"
	"math/rand/v2"
	"net/http"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/platform/httpx"
	"tolerance/internal/tasks"
)

// People compare two agents' apps at one task without seeing whose they are and pick the better one (or call it a
// tie). Each pick moves the two agents' Elo at that task: a human ranking next to the checks' score.

// Contender is one side of a blind pair: only what shows the app, nothing that names the agent.
type Contender struct {
	ID            string `json:"id"`
	HasShot       bool   `json:"has_shot"`
	HasShotMobile bool   `json:"has_shot_mobile"`
	PreviewURL    string `json:"preview_url,omitempty"`
}

type Pair struct {
	Task      string     `json:"task"`
	TaskTitle tasks.Text `json:"task_title"`
	A         Contender  `json:"a"`
	B         Contender  `json:"b"`
	// Left counts the pairs at this task the voter hasn't voted on yet, this one included.
	Left int `json:"left"`
}

// Rating is an agent's standing from people's votes at one task.
type Rating struct {
	Elo    int `json:"elo"`
	Votes  int `json:"votes"`
	Wins   int `json:"wins"`
	Losses int `json:"losses"`
	Ties   int `json:"ties"`
}

const (
	eloStart = 1000.0
	eloK     = 32.0
)

type pairKey struct{ a, b string }

func keyOf(x, y string) pairKey {
	if x > y {
		x, y = y, x
	}
	return pairKey{x, y}
}

// NextPair picks two apps for userID to compare: each agent's best run at the task (as on Compare) whose app
// started, not the voter's own agents, a pair they haven't voted on, the pairs with the fewest votes first. task ""
// means any task. nil = nothing left to vote on.
func (s *Service) NextPair(ctx context.Context, userID, task string) (*Pair, error) {
	slugs := []string{task}
	if task == "" {
		slugs = nil
		for _, t := range tasks.All() {
			slugs = append(slugs, t.Slug)
		}
		rand.Shuffle(len(slugs), func(i, j int) { slugs[i], slugs[j] = slugs[j], slugs[i] })
	} else if tasks.BySlug(task) == nil {
		return nil, invalid("Unknown task")
	}
	for _, slug := range slugs {
		p, err := s.nextPairAt(ctx, userID, slug)
		if p != nil || err != nil {
			return p, err
		}
	}
	return nil, nil
}

func (s *Service) nextPairAt(ctx context.Context, userID, task string) (*Pair, error) {
	all, err := s.Compare(ctx, task)
	if err != nil {
		return nil, err
	}
	mine := map[string]bool{}
	voted := map[pairKey]bool{}
	counts := map[pairKey]int{}
	err = s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT id FROM agents WHERE owner_id = $1`, userID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			mine[id] = true
		}
		if err := rows.Err(); err != nil {
			return err
		}
		rows, err = tx.Query(ctx, `SELECT run_a, run_b, user_id = $2 FROM pair_votes WHERE task = $1`, task, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a, b string
			var own bool
			if err := rows.Scan(&a, &b, &own); err != nil {
				return err
			}
			counts[keyOf(a, b)]++
			if own {
				voted[keyOf(a, b)] = true
			}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	var cands []Run
	for _, r := range all {
		if r.AppStarted && r.HasShot && !mine[r.Agent.ID] {
			cands = append(cands, r)
		}
	}
	type option struct{ a, b Run }
	var open []option
	least := math.MaxInt
	var best []option
	for i := range cands {
		for j := i + 1; j < len(cands); j++ {
			k := keyOf(cands[i].ID, cands[j].ID)
			if voted[k] {
				continue
			}
			o := option{cands[i], cands[j]}
			open = append(open, o)
			switch n := counts[k]; {
			case n < least:
				least, best = n, []option{o}
			case n == least:
				best = append(best, o)
			}
		}
	}
	if len(best) == 0 {
		return nil, nil
	}
	o := best[rand.IntN(len(best))]
	if rand.IntN(2) == 0 {
		o.a, o.b = o.b, o.a
	}
	side := func(r Run) Contender {
		return Contender{ID: r.ID, HasShot: r.HasShot, HasShotMobile: r.HasShotMobile, PreviewURL: r.PreviewURL}
	}
	return &Pair{Task: task, TaskTitle: o.a.TaskTitle, A: side(o.a), B: side(o.b), Left: len(open)}, nil
}

// Reveal names the agents behind a pair once the vote is in.
type Reveal struct {
	A AgentRef `json:"a"`
	B AgentRef `json:"b"`
}

// Vote records userID's pick between runs a and b: winner is "a", "b" or "tie". Both must be finished runs of
// different agents at one task, neither of them the voter's.
func (s *Service) Vote(ctx context.Context, userID, a, b, winner string) (Reveal, error) {
	if winner != "a" && winner != "b" && winner != "tie" {
		return Reveal{}, invalid(`winner must be "a", "b" or "tie"`)
	}
	if a == b {
		return Reveal{}, invalid("Pick two different runs")
	}
	ra, err := s.Get(ctx, a)
	if err != nil {
		return Reveal{}, err
	}
	rb, err := s.Get(ctx, b)
	if err != nil {
		return Reveal{}, err
	}
	if ra.Status != "done" || rb.Status != "done" || !ra.AppStarted || !rb.AppStarted {
		return Reveal{}, invalid("Both runs must be finished apps")
	}
	if ra.Task != rb.Task || ra.Agent.ID == rb.Agent.ID {
		return Reveal{}, invalid("The runs must be different agents at the same task")
	}
	// Stored in id order: flip the winner with the pair.
	if a > b {
		a, b = b, a
		switch winner {
		case "a":
			winner = "b"
		case "b":
			winner = "a"
		}
	}
	err = s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var blocked bool
		var own int
		if err := tx.QueryRow(ctx, `SELECT u.blocked, (SELECT count(*) FROM agents WHERE id IN ($2, $3) AND owner_id = u.id)
			FROM users u WHERE u.id = $1`, userID, ra.Agent.ID, rb.Agent.ID).Scan(&blocked, &own); err != nil {
			return err
		}
		if blocked {
			return httpx.New(http.StatusForbidden, "blocked", "Your account can't vote")
		}
		if own > 0 {
			return invalid("You can't vote on your own agent's app")
		}
		tag, err := tx.Exec(ctx, `INSERT INTO pair_votes (user_id, task, run_a, run_b, winner) VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT DO NOTHING`, userID, ra.Task, a, b, winner)
		if err == nil && tag.RowsAffected() == 0 {
			return httpx.StateConflict("You have already voted on this pair")
		}
		return err
	})
	if err != nil {
		return Reveal{}, err
	}
	return Reveal{A: ra.Agent, B: rb.Agent}, nil
}

// Ratings replays the task's votes in order into each agent's Elo (keyed by agent id). A vote counts for the agent
// even after a newer run became its best: it is the agent being ranked.
func (s *Service) Ratings(ctx context.Context, task string) (map[string]Rating, error) {
	elo := map[string]float64{}
	out := map[string]Rating{}
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT ra.agent_id, rb.agent_id, v.winner FROM pair_votes v
			JOIN runs ra ON ra.id = v.run_a JOIN runs rb ON rb.id = v.run_b
			WHERE v.task = $1 ORDER BY v.created_at`, task)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a, b, winner string
			if err := rows.Scan(&a, &b, &winner); err != nil {
				return err
			}
			if a == b {
				continue
			}
			for _, id := range []string{a, b} {
				if _, ok := elo[id]; !ok {
					elo[id] = eloStart
				}
			}
			sa := 0.5
			ra, rb := out[a], out[b]
			switch winner {
			case "a":
				sa = 1
				ra.Wins++
				rb.Losses++
			case "b":
				sa = 0
				ra.Losses++
				rb.Wins++
			default:
				ra.Ties++
				rb.Ties++
			}
			ea := 1 / (1 + math.Pow(10, (elo[b]-elo[a])/400))
			elo[a] += eloK * (sa - ea)
			elo[b] -= eloK * (sa - ea)
			ra.Votes++
			rb.Votes++
			out[a], out[b] = ra, rb
		}
		return rows.Err()
	})
	for id, r := range out {
		r.Elo = int(math.Round(elo[id]))
		out[id] = r
	}
	return out, err
}
