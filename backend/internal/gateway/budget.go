package gateway

// The run's token budget. What counts is fresh input, cache writes and output (thinking included) as the provider
// reports them; cache reads don't. A run has up to maxParallel requests in flight, and none of them may spend what
// another has already been promised:
//
//   - Admission: a request reserves its input (estimated generously from its body, inputEstimate) plus its output
//     cap. If the cap doesn't fit what is left, the gateway lowers it in the request (max_tokens and its kin), where
//     the API has such a field. A request that doesn't fit at all waits while others are in flight (their unused
//     reservations come back); with none in flight it closes the budget: refused, and the run stops
//     (agent_exit = budget).
//   - Settling: when the response ends, the reservation is replaced by the usage the response reported. A response
//     cut short (broken stream, client gone, refused encoding) or one that never reported usage is charged its whole
//     reservation: missing usage is not zero. An upstream error status is charged what it reported (providers don't
//     bill errors), and a request that never reached the provider costs nothing.
//   - Usage the database didn't take stays counted here and goes with the token's next write.
//
// So a run can only overshoot when the provider counts more input than the estimate or the API has no output cap to
// lower (ChatGPT's Codex backend). A run that ends over its budget is left out of the rankings (runs.rankedLimits).

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/platform/db"
	"tolerance/internal/runs"
)

// maxParallel is how many LLM requests one token (one run's agent) has in flight at once.
const maxParallel = 4

const (
	// defaultOutput is the output reserved for a request without a cap of its own (more than models write in one
	// response). When less than that is left, the gateway sets the cap.
	defaultOutput = 128_000
	// imageTokens is what one embedded image is reckoned at, whatever its size in base64.
	imageTokens = 3_000
	// promptOverhead covers what the provider adds to the body (tool-use system prompts, message framing).
	promptOverhead = 512
)

// spent is token usage as it goes into the run's counters.
type spent struct{ in, out, cacheRead, cacheWrite, requests int64 }

// budgeted is the part the budget counts.
func (s spent) budgeted() int64 { return s.in + s.out + s.cacheWrite }

func (s *spent) add(o spent) {
	s.in, s.out, s.cacheRead, s.cacheWrite, s.requests = s.in+o.in, s.out+o.out, s.cacheRead+o.cacheRead, s.cacheWrite+o.cacheWrite, s.requests+o.requests
}

// store is the gateway's view of the database.
type store interface {
	lookup(ctx context.Context, token string) (grant, error)
	// record adds s to the run's counters, and one request under model when model isn't "".
	record(ctx context.Context, runID string, s spent, model string) error
	// closeBudget marks the run as out of budget: the worker stops its agent.
	closeBudget(ctx context.Context, runID string) error
	// rejectKey marks the run's key as refused by the provider, unless a request already got through (a key revoked
	// or a subscription expired mid-run leaves work to check): the worker stops the agent and doesn't score it.
	rejectKey(ctx context.Context, runID string) error
}

type pgStore struct{ pool *db.Pool }

func (s pgStore) lookup(ctx context.Context, token string) (grant, error) {
	var gr grant
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT t.run_id, r.manifest->>'provider', a.provider, a.api_key, r.token_budget,
				r.tokens_in + r.tokens_out + r.tokens_cache_write, r.status, coalesce(r.agent_exit, '') = 'budget'
			FROM gateway_tokens t JOIN runs r ON r.id = t.run_id JOIN agents a ON a.id = r.agent_id
			WHERE t.token_hash = $1 AND t.purpose = 'agent' AND t.expires_at > now()`, runs.TokenHash(token)).
			Scan(&gr.runID, &gr.provider, &gr.keyProvider, &gr.sealed, &gr.budget, &gr.used, &gr.status, &gr.closed)
	})
	return gr, err
}

// maxModels caps the distinct model ids recorded per run.
const maxModels = 20

func (s pgStore) record(ctx context.Context, runID string, u spent, model string) error {
	return s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		// models gets the request under its model, up to maxModels distinct ids (an agent can name any model).
		_, err := tx.Exec(ctx, `UPDATE runs SET tokens_in = tokens_in + $2, tokens_out = tokens_out + $3, tokens_cache_read = tokens_cache_read + $4,
			tokens_cache_write = tokens_cache_write + $5, llm_requests = llm_requests + $6,
			models = CASE WHEN $7 = '' OR (NOT models ? $7 AND (SELECT count(*) FROM jsonb_object_keys(models)) >= $8) THEN models
				ELSE models || jsonb_build_object($7::text, coalesce((models->>$7)::int, 0) + 1) END,
			updated_at = now() WHERE id = $1`,
			runID, u.in, u.out, u.cacheRead, u.cacheWrite, u.requests, model, maxModels)
		return err
	})
}

func (s pgStore) closeBudget(ctx context.Context, runID string) error {
	return s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE runs SET agent_exit = 'budget', updated_at = now() WHERE id = $1 AND status = 'agent'`, runID)
		return err
	})
}

func (s pgStore) rejectKey(ctx context.Context, runID string) error {
	return s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE runs SET agent_exit = 'key_rejected', updated_at = now()
			WHERE id = $1 AND status = 'agent' AND agent_exit IS NULL AND llm_requests = 0`, runID)
		return err
	})
}

// account is one token's requests in flight: their slots, what they have reserved, and usage not yet written.
type account struct {
	slots chan struct{}
	users int // requests holding or waiting for the account (guarded by Gateway.mu, like the fields below)
	// ledger is held while the run's spent tokens are read from or written to the database, so an admission never
	// sees the database and the reservations out of step.
	ledger   chan struct{}
	reserved int64
	unsaved  spent
	maxIn    int64         // the largest input (cached or not) a response has reported
	changed  chan struct{} // closed and replaced whenever a reservation comes back
}

func (a *account) lock()   { a.ledger <- struct{}{} }
func (a *account) unlock() { <-a.ledger }

// join returns the token's account; leave when the request is over.
func (g *Gateway) join(key string) (a *account, leave func()) {
	g.mu.Lock()
	a = g.accounts[key]
	if a == nil {
		a = &account{slots: make(chan struct{}, maxParallel), ledger: make(chan struct{}, 1), changed: make(chan struct{})}
		g.accounts[key] = a
	}
	a.users++
	g.mu.Unlock()
	return a, func() {
		g.mu.Lock()
		if a.users--; a.users == 0 && a.unsaved == (spent{}) {
			delete(g.accounts, key)
		}
		g.mu.Unlock()
	}
}

// refusal is an answer the gateway gives instead of the provider's.
type refusal struct {
	status    int
	kind, msg string
}

func (r *refusal) Error() string { return r.msg }

func exhausted(msg string) *refusal {
	return &refusal{status: 429, kind: "rate_limit_error", msg: msg}
}

// admit reserves the request's share of the budget, waiting while requests in flight hold what it needs. vet refuses
// a grant for reasons other than the budget.
func (g *Gateway) admit(ctx context.Context, a *account, token string, p *plan, vet func(grant) *refusal) (grant, reservation, error) {
	for {
		select {
		case a.ledger <- struct{}{}:
		case <-ctx.Done():
			return grant{}, reservation{}, ctx.Err()
		}
		gr, err := g.store.lookup(ctx, token)
		if err != nil {
			a.unlock()
			return gr, reservation{}, err
		}
		if r := vet(gr); r != nil {
			a.unlock()
			return gr, reservation{}, r
		}
		g.mu.Lock()
		spentSoFar := gr.used + a.unsaved.budgeted()
		left := gr.budget - spentSoFar - a.reserved
		others, changed := a.reserved > 0, a.changed
		var res reservation
		ok := !gr.closed && spentSoFar < gr.budget
		if ok {
			res, ok = p.reserve(left, a.maxIn)
		}
		if ok {
			a.reserved += res.total()
		}
		g.mu.Unlock()
		switch {
		case ok:
			a.unlock()
			return gr, res, nil
		case gr.closed || spentSoFar >= gr.budget:
			a.unlock()
			return gr, res, exhausted("token budget exhausted for this run")
		case !others:
			cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
			if err := g.store.closeBudget(cctx, gr.runID); err != nil {
				g.log.Error("close budget", "run_id", gr.runID, "err", err)
			}
			cancel()
			a.unlock()
			return gr, res, exhausted("token budget exhausted for this run: this request (about " + strconv.FormatInt(p.input(a.maxIn), 10) +
				" input tokens) doesn't fit the " + strconv.FormatInt(max(left, 0), 10) + " left, so the run's budget is closed")
		}
		a.unlock()
		select {
		case <-changed:
		case <-ctx.Done():
			return gr, reservation{}, ctx.Err()
		}
	}
}

// settle replaces the request's reservation with what it was charged.
func (g *Gateway) settle(a *account, gr grant, res reservation, m *usage) {
	c, seenIn, model := m.charge(res)
	a.lock()
	defer a.unlock()
	g.mu.Lock()
	total := a.unsaved
	g.mu.Unlock()
	total.add(c)
	var err error
	if total != (spent{}) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err = g.store.record(ctx, gr.runID, total, model)
		cancel()
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if err != nil {
		g.log.Error("record usage", "run_id", gr.runID, "err", err)
		a.unsaved.add(c) // counted against the budget here until a later write takes it (its model count is lost)
	} else {
		a.unsaved = spent{}
	}
	a.maxIn = max(a.maxIn, seenIn)
	a.reserved -= res.total()
	close(a.changed)
	a.changed = make(chan struct{})
}

// reservation is what a request in flight holds of the budget.
type reservation struct{ in, out int64 }

func (r reservation) total() int64 { return r.in + r.out }

// plan is what admission knows of a request before sending it.
type plan struct {
	generation bool  // spends tokens; the rest (counting tokens, listing models) are free
	in         int64 // estimated input
	stateful   bool  // continues a response stored upstream: its input is more than the body
	out        int64 // the output cap the request sets, 0 = none
	n          int64 // choices asked for, each up to out
	// setCap returns the body with the output cap set to v; nil where the API has no field the gateway may set.
	setCap func(v int64) ([]byte, error)
	body   []byte // the body to send: the request's, or one with a lowered cap
}

func (p *plan) input(maxIn int64) int64 {
	if p.stateful {
		return p.in + maxIn
	}
	return p.in
}

// reserve fits the request into left tokens, lowering its output cap if it must.
func (p *plan) reserve(left, maxIn int64) (reservation, bool) {
	if !p.generation {
		return reservation{}, true
	}
	in := p.input(maxIn)
	room := left - in
	if room < p.n {
		return reservation{}, false
	}
	want := p.out
	if want <= 0 {
		want = defaultOutput
	}
	per := min(want, room/p.n)
	if per < want && p.setCap != nil {
		body, err := p.setCap(per)
		if err != nil {
			return reservation{}, false
		}
		p.body = body
	}
	if per < want && p.setCap == nil {
		per = room / p.n // nothing to lower: hold all that's left
	}
	return reservation{in: in, out: per * p.n}, true
}

// planFor reads what admission needs out of a request body.
func planFor(protocol, method, path string, body []byte) *plan {
	p := &plan{body: body, n: 1}
	if method != "POST" || strings.HasSuffix(path, "/count_tokens") || strings.HasSuffix(path, ":countTokens") {
		return p
	}
	p.generation = true
	p.in = inputEstimate(body)
	var req map[string]json.RawMessage
	if json.Unmarshal(body, &req) != nil || req == nil {
		return p
	}
	set := func(m map[string]json.RawMessage, k string, v int64) {
		m[k] = json.RawMessage(strconv.FormatInt(v, 10))
	}
	setter := func(field string) func(int64) ([]byte, error) {
		return func(v int64) ([]byte, error) {
			set(req, field, v)
			return json.Marshal(req)
		}
	}
	switch {
	case protocol == "anthropic":
		p.out = intField(req, "max_tokens")
		p.setCap = func(v int64) ([]byte, error) {
			set(req, "max_tokens", v)
			// Extended thinking must stay under max_tokens.
			var th map[string]json.RawMessage
			if json.Unmarshal(req["thinking"], &th) == nil && th != nil && intField(th, "budget_tokens") >= v {
				set(th, "budget_tokens", max(v-1, 1))
				raw, err := json.Marshal(th)
				if err != nil {
					return nil, err
				}
				req["thinking"] = raw
			}
			return json.Marshal(req)
		}
	case protocol == "openai" && path == "/v1/chat/completions":
		field := "max_completion_tokens"
		if _, ok := req[field]; !ok {
			if _, ok := req["max_tokens"]; ok {
				field = "max_tokens"
			}
		}
		p.out = intField(req, field)
		p.n = max(intField(req, "n"), 1)
		p.setCap = setter(field)
	case protocol == "openai":
		p.out = intField(req, "max_output_tokens")
		p.setCap = setter("max_output_tokens")
		p.stateful = present(req, "previous_response_id") || present(req, "conversation")
	case protocol == "gemini":
		var gc map[string]json.RawMessage
		_ = json.Unmarshal(req["generationConfig"], &gc)
		if gc == nil {
			gc = map[string]json.RawMessage{}
		}
		p.out = intField(gc, "maxOutputTokens")
		p.n = max(intField(gc, "candidateCount"), 1)
		p.setCap = func(v int64) ([]byte, error) {
			set(gc, "maxOutputTokens", v)
			raw, err := json.Marshal(gc)
			if err != nil {
				return nil, err
			}
			req["generationConfig"] = raw
			return json.Marshal(req)
		}
	}
	// chatgpt (Codex on a subscription): its backend refuses max_output_tokens, so there is no cap to lower.
	return p
}

func intField(m map[string]json.RawMessage, k string) int64 {
	var v float64
	if json.Unmarshal(m[k], &v) != nil {
		return 0
	}
	return int64(v)
}

func present(m map[string]json.RawMessage, k string) bool {
	v, ok := m[k]
	return ok && string(v) != "null" && string(v) != `""`
}

// inputEstimate is a generous guess at a request's input tokens before the provider counts them: a token per three
// bytes of the body (real text and code run nearer four), and a fixed imageTokens for each embedded image.
func inputEstimate(body []byte) int64 {
	text, images := int64(len(body)), int64(0)
	var doc any
	if json.Unmarshal(body, &doc) == nil {
		var walk func(any)
		walk = func(v any) {
			switch v := v.(type) {
			case map[string]any:
				for _, x := range v {
					walk(x)
				}
			case []any:
				for _, x := range v {
					walk(x)
				}
			case string:
				if isImage(v) {
					text -= int64(len(v))
					images++
				}
			}
		}
		walk(doc)
	}
	return max(text, 0)/3 + images*imageTokens + promptOverhead
}

// imageMagic is how base64 PNG, JPEG, GIF and WebP files begin.
var imageMagic = []string{"iVBORw0KGgo", "/9j/", "R0lGOD", "UklGR"}

// isImage tells an embedded base64 image (bare, or a data: URL) from text. Other payloads (PDFs) count by size.
func isImage(s string) bool {
	if len(s) < 1024 {
		return false
	}
	if rest, ok := strings.CutPrefix(s, "data:image/"); ok {
		_, b64, ok := strings.Cut(rest, ";base64,")
		return ok && base64ish(b64)
	}
	for _, m := range imageMagic {
		if strings.HasPrefix(s, m) {
			return base64ish(s)
		}
	}
	return false
}

func base64ish(s string) bool {
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '+' || c == '/' || c == '=' || c == '\n' || c == '\r') {
			return false
		}
	}
	return true
}

// unsent: the request never got to the provider (it couldn't be dialled), so nothing was spent.
func unsent(err error) bool {
	var op *net.OpError
	return errors.As(err, &op) && op.Op == "dial"
}
