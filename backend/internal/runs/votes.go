package runs

import (
	"context"
	"errors"
	"math"
	"math/rand/v2"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/platform/httpx"
	"tolerance/internal/platform/idgen"
	"tolerance/internal/tasks"
)

// People compare two agents' apps at one task without seeing whose they are and pick the better one (or call it a
// tie). All the picks at a task together rate its agents (Bradley–Terry, on Elo's scale): a human ranking next to the
// checks' score.

// Contender is one side of a blind pair: only what shows the app, nothing that names the agent or the run. Alias
// serves its shots (/api/v1/vote/{alias}/shot.jpg) and its live preview (the preview host takes it like a run hex).
type Contender struct {
	Alias         string `json:"alias"`
	HasShot       bool   `json:"has_shot"`
	HasShotMobile bool   `json:"has_shot_mobile"`
	PreviewURL    string `json:"preview_url,omitempty"`
}

type Pair struct {
	ID        string     `json:"id"` // what the vote names (POST /api/v1/my/votes)
	Task      string     `json:"task"`
	TaskTitle tasks.Text `json:"task_title"`
	// Scenarios: what to try in both apps before picking (the voted kinds: invent, startup).
	Scenarios []tasks.Text `json:"scenarios,omitempty"`
	A         Contender    `json:"a"`
	B         Contender    `json:"b"`
	// Left counts the pairs at this task the voter hasn't voted on yet, this one included.
	Left int `json:"left"`
}

// Rating is an agent's standing from people's votes at one task. Elo is the Bradley–Terry strength on Elo's scale
// (1000 = an average agent, +400 = ten times the odds of winning); CI is the 95% interval around it, ±points.
// Provisional: under provisionalVotes votes, too few to read the rating as a result.
type Rating struct {
	Elo         int  `json:"elo"`
	CI          int  `json:"ci"`
	Provisional bool `json:"provisional"`
	Votes       int  `json:"votes"`
	Wins        int  `json:"wins"`
	Losses      int  `json:"losses"`
	Ties        int  `json:"ties"`
}

const (
	provisionalVotes = 30
	// An account's votes count in the ratings once it is a day old (until then they wait): a fresh account is the cheap way to
	// stuff votes, and a day lets the admin block it first.
	voteAccountAge = "1 day"
	// Pairs handed out and never voted on are dropped after this.
	votePairTTL = "1 day"
)

// alias is a random 32-hex label: the same shape as a run's preview host, so the preview gateway tells them apart
// only by looking it up.
func alias() string { return strings.TrimPrefix(idgen.New("x"), "x_") }

type pairKey struct{ a, b string }

func keyOf(x, y string) pairKey {
	if x > y {
		x, y = y, x
	}
	return pairKey{x, y}
}

// NextPair picks two apps for userID to compare: each agent's median run at the task (as on Compare) whose app
// started, not the voter's own agents, a pair they haven't voted on, the pairs with the fewest votes first. task ""
// means any task. userID "" is a guest: they see the pair, and signing in to vote claims it. nil = nothing left.
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
	pair := &Pair{ID: idgen.New("vp"), Task: task, TaskTitle: o.a.TaskTitle, Left: len(open)}
	if t := tasks.BySlug(task); t != nil {
		pair.Scenarios = t.Scenarios
	}
	side := func(r Run) Contender {
		c := Contender{Alias: alias(), HasShot: r.HasShot, HasShotMobile: r.HasShotMobile}
		if r.PreviewURL != "" {
			c.PreviewURL = strings.ReplaceAll(s.PreviewURL, "{id}", c.Alias)
		}
		return c
	}
	pair.A, pair.B = side(o.a), side(o.b)
	err = s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM vote_pairs WHERE created_at < now() - $1::interval`, votePairTTL); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO vote_pairs (id, user_id, task, run_a, run_b, alias_a, alias_b) VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7)`,
			pair.ID, userID, task, o.a.ID, o.b.ID, pair.A.Alias, pair.B.Alias)
		return err
	})
	if err != nil {
		return nil, err
	}
	return pair, nil
}

// VoteShot is a shot (column shot or shot_mobile) of one side of a pair, by the side's alias. The alias is random and
// only its pair's page knows it, as with the live preview, so it needs no session.
func (s *Service) VoteShot(ctx context.Context, side, column string) ([]byte, error) {
	var run string
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT CASE WHEN alias_a = $1 THEN run_a ELSE run_b END FROM vote_pairs
			WHERE alias_a = $1 OR alias_b = $1`, side).Scan(&run)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.NotFound()
	}
	if err != nil {
		return nil, err
	}
	return s.Blob(ctx, run, column)
}

// Reveal names the agents behind a pair once the vote is in.
type Reveal struct {
	A AgentRef `json:"a"`
	B AgentRef `json:"b"`
	// CountsAt is when the voter's account is voteAccountAge old and their votes start counting (absent once they do).
	CountsAt *time.Time `json:"counts_at,omitempty"`
}

// Vote records userID's pick in the pair they were handed, or in a guest's pair (a guest signs in to vote): winner is
// "a", "b" or "tie". Both must be finished runs of different agents at one task, neither of them the voter's.
func (s *Service) Vote(ctx context.Context, userID, pairID, winner string) (Reveal, error) {
	if winner != "a" && winner != "b" && winner != "tie" {
		return Reveal{}, invalid(`winner must be "a", "b" or "tie"`)
	}
	var a, b string
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT run_a, run_b FROM vote_pairs WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)`, pairID, userID).Scan(&a, &b)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Reveal{}, httpx.StateConflict("This pair has expired: load the next one")
	}
	if err != nil {
		return Reveal{}, err
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
	var countsAt *time.Time
	err = s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var blocked bool
		var own int
		if err := tx.QueryRow(ctx, `SELECT u.blocked, (SELECT count(*) FROM agents WHERE id IN ($2, $3) AND owner_id = u.id),
				CASE WHEN u.created_at > now() - $4::interval THEN u.created_at + $4::interval END
			FROM users u WHERE u.id = $1`, userID, ra.Agent.ID, rb.Agent.ID, voteAccountAge).Scan(&blocked, &own, &countsAt); err != nil {
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
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM vote_pairs WHERE id = $1`, pairID)
		return err
	})
	if err != nil {
		return Reveal{}, err
	}
	if countsAt != nil {
		u := countsAt.UTC()
		countsAt = &u
	}
	return Reveal{A: ra.Agent, B: rb.Agent, CountsAt: countsAt}, nil
}

// CachedRatings is Ratings kept for publicTTL: every run page and task page asks for it.
func (s *Service) CachedRatings(ctx context.Context, task string) (map[string]Rating, error) {
	return memoize(&s.public, "ratings\x00"+task, publicTTL, func() (map[string]Rating, error) { return s.Ratings(ctx, task) })
}

// Ratings rates the task's agents (keyed by agent id) from all its votes at once (bradleyTerry), so the order of the
// votes doesn't matter. A vote counts for the agent even after a newer run became its leaderboard run: it is the
// agent being ranked. Votes of blocked users, and those cast in an account younger than voteAccountAge (they count
// once it is that old), are left out.
func (s *Service) Ratings(ctx context.Context, task string) (map[string]Rating, error) {
	out := map[string]Rating{}
	var games []game
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT ra.agent_id, rb.agent_id, v.winner FROM pair_votes v
			JOIN runs ra ON ra.id = v.run_a JOIN runs rb ON rb.id = v.run_b JOIN users u ON u.id = v.user_id
			WHERE v.task = $1 AND NOT u.blocked AND u.created_at <= now() - $2::interval`, task, voteAccountAge)
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
			ra, rb := out[a], out[b]
			g := game{a: a, b: b, score: 0.5}
			switch winner {
			case "a":
				g.score = 1
				ra.Wins++
				rb.Losses++
			case "b":
				g.score = 0
				ra.Losses++
				rb.Wins++
			default:
				ra.Ties++
				rb.Ties++
			}
			ra.Votes++
			rb.Votes++
			out[a], out[b] = ra, rb
			games = append(games, g)
		}
		return rows.Err()
	})
	strength, ci := bradleyTerry(games)
	for id, r := range out {
		r.Elo, r.CI = int(math.Round(strength[id])), int(math.Round(ci[id]))
		r.Provisional = r.Votes < provisionalVotes
		out[id] = r
	}
	return out, err
}

// game is one counted vote: score is a's result against b (1 win, 0.5 tie, 0 loss).
type game struct {
	a, b  string
	score float64
}

const (
	// btPrior is the standard deviation of the prior on an agent's log-strength: it keeps an unbeaten agent's rating
	// finite and pulls an agent with a few votes towards the average (1 ≈ 174 Elo points).
	btPrior = 1.0
	eloUnit = 400 / math.Ln10 // Elo points per unit of log-strength
)

// bradleyTerry fits every agent's strength to all the games at once: P(a beats b) = 1 / (1 + e^(θb−θa)), a tie
// counting as half a win each, with a normal prior N(0, btPrior²) on θ. Newton's method finds the most likely θ; the
// interval comes from the curvature there (the Laplace approximation). It returns the ratings on Elo's scale around
// 1000 and their 95% half-widths.
func bradleyTerry(games []game) (rating, ci map[string]float64) {
	idx := map[string]int{}
	var ids []string
	for _, g := range games {
		for _, id := range []string{g.a, g.b} {
			if _, ok := idx[id]; !ok {
				idx[id] = len(ids)
				ids = append(ids, id)
			}
		}
	}
	n := len(ids)
	theta := make([]float64, n)
	// info is minus the Hessian of the log-posterior: the precision of θ.
	info := func() [][]float64 {
		m := make([][]float64, n)
		for i := range m {
			m[i] = make([]float64, n)
			m[i][i] = 1 / (btPrior * btPrior)
		}
		for _, g := range games {
			i, j := idx[g.a], idx[g.b]
			p := 1 / (1 + math.Exp(theta[j]-theta[i]))
			w := p * (1 - p)
			m[i][i] += w
			m[j][j] += w
			m[i][j] -= w
			m[j][i] -= w
		}
		return m
	}
	for iter := 0; iter < 100; iter++ {
		grad := make([]float64, n)
		for i := range grad {
			grad[i] = -theta[i] / (btPrior * btPrior)
		}
		for _, g := range games {
			i, j := idx[g.a], idx[g.b]
			p := 1 / (1 + math.Exp(theta[j]-theta[i]))
			grad[i] += g.score - p
			grad[j] -= g.score - p
		}
		step := solve(info(), grad)
		biggest := 0.0
		for _, d := range step {
			biggest = max(biggest, math.Abs(d))
		}
		// Damped: far from the optimum a full Newton step can overshoot.
		scale := 1.0
		if biggest > 1 {
			scale = 1 / biggest
		}
		for i := range theta {
			theta[i] += scale * step[i]
		}
		if biggest < 1e-9 {
			break
		}
	}
	// The votes say nothing about a shift of every θ at once (only the prior does), so the interval is of each agent's
	// distance from the average (θ sums to 0 at the optimum: 1000 is the average): v = e_i − 1/n, Var = vᵀ·info⁻¹·v.
	cov := invert(info())
	rowMean := make([]float64, n)
	all := 0.0
	for i := range cov {
		for _, c := range cov[i] {
			rowMean[i] += c / float64(n)
		}
		all += rowMean[i] / float64(n)
	}
	rating, ci = map[string]float64{}, map[string]float64{}
	for i, id := range ids {
		variance := max(cov[i][i]-2*rowMean[i]+all, 0)
		rating[id] = 1000 + eloUnit*theta[i]
		ci[id] = 1.96 * eloUnit * math.Sqrt(variance)
	}
	return rating, ci
}

// solve returns x with m·x = b (see eliminate); m and b stay as they are.
func solve(m [][]float64, b []float64) []float64 {
	a := make([][]float64, len(b))
	for i := range a {
		a[i] = append(append([]float64{}, m[i]...), b[i])
	}
	x := eliminate(a, 1)
	out := make([]float64, len(b))
	for i := range out {
		out[i] = x[i][0]
	}
	return out
}

// invert returns m⁻¹ (see eliminate); m stays as it is.
func invert(m [][]float64) [][]float64 {
	n := len(m)
	a := make([][]float64, n)
	for i := range a {
		a[i] = append(append([]float64{}, m[i]...), make([]float64, n)...)
		a[i][n+i] = 1
	}
	return eliminate(a, n)
}

// eliminate solves m·X = B for the n×(n+k) matrix a = [m | B] by Gaussian elimination with partial pivoting (m is
// symmetric positive definite here, thanks to the prior) and returns X, n×k; a is used up.
func eliminate(a [][]float64, k int) [][]float64 {
	n := len(a)
	for c := 0; c < n; c++ {
		p := c
		for r := c + 1; r < n; r++ {
			if math.Abs(a[r][c]) > math.Abs(a[p][c]) {
				p = r
			}
		}
		a[c], a[p] = a[p], a[c]
		for r := c + 1; r < n; r++ {
			f := a[r][c] / a[c][c]
			for j := c; j < n+k; j++ {
				a[r][j] -= f * a[c][j]
			}
		}
	}
	x := make([][]float64, n)
	for r := n - 1; r >= 0; r-- {
		x[r] = make([]float64, k)
		for j := range k {
			v := a[r][n+j]
			for q := r + 1; q < n; q++ {
				v -= a[r][q] * x[q][j]
			}
			x[r][j] = v / a[r][r]
		}
	}
	return x
}
