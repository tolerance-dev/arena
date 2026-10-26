package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/platform/secretbox"
)

// memStore is one run in memory instead of the database.
type memStore struct {
	mu         sync.Mutex
	sealed     []byte
	budget     int64
	spent      spent
	closed     bool
	rejected   bool
	failWrites int // how many usage writes fail before they work again
}

func (m *memStore) lookup(_ context.Context, token string) (grant, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if token != "run-token" {
		return grant{}, pgx.ErrNoRows
	}
	return grant{runID: "run_1", provider: "anthropic", keyProvider: "anthropic", sealed: m.sealed, budget: m.budget, used: m.spent.budgeted(),
		status: "agent", closed: m.closed}, nil
}

func (m *memStore) record(_ context.Context, _ string, s spent, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.failWrites > 0 {
		m.failWrites--
		return errors.New("database is down")
	}
	m.spent.add(s)
	return nil
}

func (m *memStore) closeBudget(context.Context, string) error {
	m.mu.Lock()
	m.closed = true
	m.mu.Unlock()
	return nil
}

func (m *memStore) rejectKey(context.Context, string) error {
	m.mu.Lock()
	m.rejected = true
	m.mu.Unlock()
	return nil
}

func (m *memStore) isRejected() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.rejected
}

func (m *memStore) used() spent {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.spent
}

// testGateway puts a gateway with a budget of budget tokens (already spent: used) in front of upstream.
func testGateway(t *testing.T, budget, used int64, upstream http.Handler) (*Gateway, *memStore, string) {
	t.Helper()
	box, err := secretbox.New("a test secret key")
	if err != nil {
		t.Fatal(err)
	}
	sealed, _ := box.Seal("real-key")
	st := &memStore{sealed: sealed, budget: budget, spent: spent{in: used}}
	g := New(nil, box, Config{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	g.store = st
	up := httptest.NewServer(upstream)
	t.Cleanup(up.Close)
	g.upstream = up.URL
	front := httptest.NewServer(g.Handler())
	t.Cleanup(front.Close)
	return g, st, front.URL
}

// greedy answers every message with 100 input tokens and all the output it was allowed: the worst case.
func greedy(seen func(maxTokens int64)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			MaxTokens int64 `json:"max_tokens"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if seen != nil {
			seen(req.MaxTokens)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"type": "message",
			"usage": map[string]any{"input_tokens": 100, "output_tokens": req.MaxTokens}})
	}
}

func message(maxTokens int64, text string) string {
	b, _ := json.Marshal(map[string]any{"model": "m", "max_tokens": maxTokens,
		"messages": []any{map[string]any{"role": "user", "content": text}}})
	return string(b)
}

func post(t *testing.T, base, body string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest("POST", base+"/anthropic/v1/messages", strings.NewReader(body))
	req.Header.Set("x-api-key", "run-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, err.Error()
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

// settled waits until the account's reservations have all come back.
func settled(t *testing.T, g *Gateway) {
	t.Helper()
	for range 200 {
		g.mu.Lock()
		var reserved int64
		for _, a := range g.accounts {
			reserved += a.reserved
		}
		busy := len(g.accounts) > 0 && reserved > 0
		g.mu.Unlock()
		if !busy {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("reservations never came back")
}

// Parallel requests can't each spend the same remainder: together they stay within the budget, the ones that would
// overrun it get a lowered max_tokens or wait, and once nothing fits the budget closes.
func TestParallelRequestsShareTheBudget(t *testing.T) {
	var mu sync.Mutex
	inFlight, peak := 0, 0
	var caps []int64
	upstream := func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		inFlight++
		peak = max(peak, inFlight)
		mu.Unlock()
		time.Sleep(50 * time.Millisecond)
		greedy(func(c int64) { mu.Lock(); caps = append(caps, c); mu.Unlock() })(w, r)
		mu.Lock()
		inFlight--
		mu.Unlock()
	}
	g, st, base := testGateway(t, 20_000, 0, http.HandlerFunc(upstream))

	var wg sync.WaitGroup
	codes := make([]int, 8)
	for i := range codes {
		wg.Go(func() { codes[i], _ = post(t, base, message(8_000, "hello")) })
	}
	wg.Wait()
	settled(t, g)

	used := st.used()
	if used.budgeted() > 20_000 {
		t.Errorf("spent %d of a 20000 budget", used.budgeted())
	}
	ok, refused := 0, 0
	for _, c := range codes {
		switch c {
		case 200:
			ok++
		case 429:
			refused++
		default:
			t.Errorf("unexpected status %d", c)
		}
	}
	lowered := false
	for _, c := range caps {
		lowered = lowered || c < 8_000
	}
	if ok < 2 || refused == 0 || !lowered || !st.closed {
		t.Errorf("ok=%d refused=%d caps=%v closed=%v", ok, refused, caps, st.closed)
	}
	if peak < 2 || peak > maxParallel {
		t.Errorf("peak in flight %d", peak)
	}
}

// A last request too big for what's left is refused before it reaches the provider, and closes the budget; a
// smaller one gets its max_tokens cut to fit.
func TestBigLastRequest(t *testing.T) {
	var caps []int64
	g, st, base := testGateway(t, 10_000, 9_000, greedy(func(c int64) { caps = append(caps, c) }))
	if code, msg := post(t, base, message(1_000, strings.Repeat("word ", 1_200))); code != 429 || !strings.Contains(msg, "budget") {
		t.Fatalf("got %d %s", code, msg)
	}
	if len(caps) != 0 || !st.closed {
		t.Fatalf("upstream called %d times, closed=%v", len(caps), st.closed)
	}
	if code, _ := post(t, base, message(100, "hi")); code != 429 {
		t.Errorf("a closed budget let a request through: %d", code)
	}

	g, st, base = testGateway(t, 10_000, 5_000, greedy(func(c int64) { caps = append(caps, c) }))
	body := message(8_000, "hello")
	if code, msg := post(t, base, body); code != 200 {
		t.Fatalf("got %d %s", code, msg)
	}
	settled(t, g)
	if want := 5_000 - inputEstimate([]byte(body)); len(caps) != 1 || caps[0] != want {
		t.Errorf("max_tokens sent %v, want %d", caps, want)
	}
	if used := st.used().budgeted(); used > 10_000 {
		t.Errorf("spent %d", used)
	}
}

// A stream cut off before its final usage is charged the whole reservation: the input it reported and all the
// output it was allowed. So is a response that never reports usage.
func TestBrokenStreamChargesTheReservation(t *testing.T) {
	broken := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":100,\"output_tokens\":1}}}\n\n")
		w.(http.Flusher).Flush()
		conn, _, err := w.(http.Hijacker).Hijack()
		if err == nil {
			_ = conn.Close()
		}
	}
	g, st, base := testGateway(t, 100_000, 0, http.HandlerFunc(broken))
	_, _ = post(t, base, message(1_000, "hi"))
	settled(t, g)
	if got := st.used(); got.in != 100 || got.out != 1_000 || got.requests != 1 {
		t.Errorf("broken stream charged %+v", got)
	}

	silent := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"type":"message","content":[]}`)
	}
	g, st, base = testGateway(t, 100_000, 0, http.HandlerFunc(silent))
	body := message(1_000, "hi")
	if code, _ := post(t, base, body); code != 200 {
		t.Fatalf("got %d", code)
	}
	settled(t, g)
	if got := st.used(); got.in != inputEstimate([]byte(body)) || got.out != 1_000 {
		t.Errorf("response without usage charged %+v", got)
	}
}

// Error answers cost what they report (nothing), and so does a provider that can't be reached.
func TestErrorsAreFree(t *testing.T) {
	failing := func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(w, `{"type":"error"}`)
	}
	g, st, base := testGateway(t, 100_000, 0, http.HandlerFunc(failing))
	if code, _ := post(t, base, message(1_000, "hi")); code != 500 {
		t.Fatalf("got %d", code)
	}
	settled(t, g)
	if got := st.used(); got != (spent{}) {
		t.Errorf("an error answer charged %+v", got)
	}

	g, st, base = testGateway(t, 100_000, 0, greedy(nil))
	g.upstream = "http://127.0.0.1:1" // nothing listens
	if code, _ := post(t, base, message(1_000, "hi")); code != 502 {
		t.Fatalf("got %d", code)
	}
	settled(t, g)
	if got := st.used(); got != (spent{}) {
		t.Errorf("an unreachable provider charged %+v", got)
	}
}

// Usage the database didn't take still counts against the budget, and goes with the next write.
func TestUsageWriteFailure(t *testing.T) {
	var caps []int64
	g, st, base := testGateway(t, 10_000, 0, greedy(func(c int64) { caps = append(caps, c) }))
	st.failWrites = 1
	if code, _ := post(t, base, message(3_000, "hi")); code != 200 {
		t.Fatalf("got %d", code)
	}
	settled(t, g)
	if got := st.used(); got != (spent{}) {
		t.Fatalf("the failed write landed: %+v", got)
	}
	body := message(9_000, "hello")
	if code, _ := post(t, base, body); code != 200 {
		t.Fatalf("got %d", code)
	}
	settled(t, g)
	if want := 10_000 - 3_100 - inputEstimate([]byte(body)); len(caps) != 2 || caps[1] != want {
		t.Errorf("max_tokens sent %v, want the second at %d", caps, want)
	}
	if got := st.used(); got.in != 200 || got.out != 3_000+caps[1] || got.requests != 2 {
		t.Errorf("recorded %+v", got)
	}
	for i := 0; ; i++ {
		g.mu.Lock()
		n := len(g.accounts)
		g.mu.Unlock()
		if n == 0 {
			break
		}
		if i == 100 {
			t.Fatal("the account outlived its requests with nothing left to write")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// The output cap goes where each API reads it, and images count at a fixed price rather than by size.
func TestPlanCaps(t *testing.T) {
	cases := []struct {
		protocol, path, body, want string
	}{
		{"openai", "/v1/chat/completions", `{"model":"m"}`, `"max_completion_tokens":500`},
		{"openai", "/v1/chat/completions", `{"model":"m","max_tokens":9000}`, `"max_tokens":500`},
		{"openai", "/v1/responses", `{"model":"m"}`, `"max_output_tokens":500`},
		{"gemini", "/v1beta/models/g:generateContent", `{"generationConfig":{"temperature":1}}`, `"maxOutputTokens":500`},
		{"anthropic", "/v1/messages", `{"max_tokens":9000,"thinking":{"type":"enabled","budget_tokens":4000}}`, `"budget_tokens":499`},
	}
	for _, c := range cases {
		p := planFor(c.protocol, "POST", c.path, []byte(c.body))
		res, ok := p.reserve(p.in+500, 0)
		if !ok || res.out != 500 || !strings.Contains(string(p.body), c.want) {
			t.Errorf("%s %s: ok=%v out=%d body=%s", c.protocol, c.path, ok, res.out, p.body)
		}
	}
	if p := planFor("anthropic", "POST", "/v1/messages/count_tokens", []byte(`{}`)); p.generation {
		t.Error("counting tokens reserves nothing")
	}
	if p := planFor("openai", "POST", "/v1/responses", []byte(`{"previous_response_id":"r"}`)); p.input(50_000) < 50_000 {
		t.Error("a continued response counts the stored input")
	}
	img := `{"messages":[{"content":[{"type":"image","source":{"data":"iVBORw0KGgo` + strings.Repeat("A", 400_000) + `"}}]}]}`
	if est := inputEstimate([]byte(img)); est > imageTokens+promptOverhead+100 {
		t.Errorf("an image estimated at %d tokens", est)
	}
}

// A key the provider refuses marks the run (before the agent sees the answer, which still reaches it); other errors
// don't.
func TestRejectedKey(t *testing.T) {
	answer := func(status int) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
			_, _ = io.WriteString(w, `{"type":"error","error":{"type":"authentication_error"}}`)
		}
	}
	_, st, base := testGateway(t, 100_000, 0, answer(http.StatusUnauthorized))
	code, body := post(t, base, message(1_000, "hi"))
	if code != 401 || !strings.Contains(body, "authentication_error") {
		t.Fatalf("got %d %s", code, body)
	}
	if !st.isRejected() {
		t.Error("a 401 from the provider didn't mark the key")
	}
	_, st, base = testGateway(t, 100_000, 0, answer(http.StatusInternalServerError))
	if code, _ := post(t, base, message(1_000, "hi")); code != 500 {
		t.Fatalf("got %d", code)
	}
	if st.isRejected() {
		t.Error("a 500 marked the key")
	}

	gemini := func(body string) *http.Response {
		return &http.Response{StatusCode: http.StatusBadRequest, Body: io.NopCloser(strings.NewReader(body))}
	}
	invalid := `{"error":{"code":400,"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}`
	resp := gemini(invalid)
	if !keyRejected("gemini", resp) {
		t.Error("Gemini's API_KEY_INVALID wasn't taken as a rejected key")
	}
	if b, _ := io.ReadAll(resp.Body); string(b) != invalid {
		t.Errorf("the body didn't reach the agent whole: %s", b)
	}
	if keyRejected("gemini", gemini(`{"error":{"code":400,"message":"bad request"}}`)) {
		t.Error("another Gemini 400 was taken as a rejected key")
	}
	if keyRejected("anthropic", gemini(invalid)) {
		t.Error("a 400 outside Gemini was taken as a rejected key")
	}
}
