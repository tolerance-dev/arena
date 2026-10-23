// Package gateway is the only way out of a sandbox. Agents (and the judge) on the internal arena-agents network
// reach it as http://gateway:8090:
//
//   - /anthropic/*, /openai/*: LLM APIs, only the generation endpoints (llmRoutes). The run token the sandbox holds
//     is swapped for the agent's real key (or the platform's judge key), usage is counted into the run, the run's
//     token budget is enforced, and a run has at most maxParallel requests in flight (more wait their turn), so the
//     budget can't be overrun by firing many requests at once.
//   - /npm/*, /pypi/*, /pyfiles/*: read-only package registries, so agents can install dependencies.
//
// Nothing else is proxied.
package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/platform/db"
	"tolerance/internal/platform/secretbox"
	"tolerance/internal/runs"
)

type Config struct {
	JudgeKey     string // Anthropic key the judge spends; "" = judging off
	FakeUpstream bool   // answer LLM calls locally (dev without keys)
	SelfURL      string // how sandboxes reach the gateway, for rewriting PyPI links
}

type Gateway struct {
	pool *db.Pool
	box  *secretbox.Box
	cfg  Config
	log  *slog.Logger

	mu    sync.Mutex
	slots map[string]*slot // by token hash
}

func New(pool *db.Pool, box *secretbox.Box, cfg Config, log *slog.Logger) *Gateway {
	return &Gateway{pool: pool, box: box, cfg: cfg, log: log.With("component", "gateway"), slots: map[string]*slot{}}
}

// maxParallel is how many LLM requests one token (one run's agent, or its judge) has in flight at once.
const maxParallel = 4

type slot struct {
	ch    chan struct{}
	users int
}

// acquire waits for one of the token's request slots; release frees it.
func (g *Gateway) acquire(ctx context.Context, key string) (release func(), err error) {
	g.mu.Lock()
	s := g.slots[key]
	if s == nil {
		s = &slot{ch: make(chan struct{}, maxParallel)}
		g.slots[key] = s
	}
	s.users++
	g.mu.Unlock()
	done := func() {
		g.mu.Lock()
		if s.users--; s.users == 0 {
			delete(g.slots, key)
		}
		g.mu.Unlock()
	}
	select {
	case s.ch <- struct{}{}:
		return func() { <-s.ch; done() }, nil
	case <-ctx.Done():
		done()
		return nil, ctx.Err()
	}
}

// llmRoutes are the only LLM endpoints proxied: generation (metered from its response), token counting and model
// lists. Everything else (batches, files, assistants, fine-tuning, …) would spend the key without a usage figure in
// the response, or outlive the run.
var llmRoutes = map[string][]string{
	"anthropic": {"POST /v1/messages", "POST /v1/messages/count_tokens", "GET /v1/models", "GET /v1/models/*"},
	"openai":    {"POST /v1/chat/completions", "POST /v1/responses", "GET /v1/models", "GET /v1/models/*"},
}

func allowedRoute(provider, method, path string) bool {
	for _, r := range llmRoutes[provider] {
		m, p, _ := strings.Cut(r, " ")
		if m != method {
			continue
		}
		if prefix, ok := strings.CutSuffix(p, "*"); ok {
			if rest, ok := strings.CutPrefix(path, prefix); ok && rest != "" && !strings.Contains(rest, "/") {
				return true
			}
		} else if path == p {
			return true
		}
	}
	return false
}

// refusedBody says why a request body can't go through, or "": OpenAI background responses come back without usage
// (it would show up only when polled later), so they'd be unmetered.
func refusedBody(provider, path string, body []byte) string {
	if provider != "openai" || path != "/v1/responses" {
		return ""
	}
	var req struct {
		Background bool `json:"background"`
	}
	if json.Unmarshal(body, &req) == nil && req.Background {
		return "background responses are not supported: their usage can't be metered"
	}
	return ""
}

const maxLLMBody = 32 << 20

var upstreams = map[string]string{
	"anthropic": "https://api.anthropic.com",
	"openai":    "https://api.openai.com",
	"npm":       "https://registry.npmjs.org",
	"pypi":      "https://pypi.org",
	"pyfiles":   "https://files.pythonhosted.org",
}

func (g *Gateway) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("ok")) })
	mux.HandleFunc("/anthropic/", func(w http.ResponseWriter, r *http.Request) { g.llm(w, r, "anthropic") })
	mux.HandleFunc("/openai/", func(w http.ResponseWriter, r *http.Request) { g.llm(w, r, "openai") })
	for _, name := range []string{"npm", "pypi", "pyfiles"} {
		mux.HandleFunc("/"+name+"/", func(w http.ResponseWriter, r *http.Request) { g.registry(w, r, name) })
	}
	return mux
}

func apiError(w http.ResponseWriter, provider string, status int, kind, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if provider == "openai" {
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"message": msg, "type": kind, "code": kind}})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"type": "error", "error": map[string]any{"type": kind, "message": msg}})
}

type grant struct {
	runID, purpose, provider string
	sealed                   []byte
	budget, used             int64
	status                   string
}

func tokenFrom(r *http.Request) string {
	if k := r.Header.Get("x-api-key"); k != "" {
		return k
	}
	return strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
}

func (g *Gateway) lookup(ctx context.Context, token string) (grant, error) {
	var gr grant
	err := g.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT t.run_id, t.purpose, a.provider, a.api_key, r.token_budget,
				r.tokens_in + r.tokens_out + r.tokens_cache_write, r.status
			FROM gateway_tokens t JOIN runs r ON r.id = t.run_id JOIN agents a ON a.id = r.agent_id
			WHERE t.token_hash = $1 AND t.expires_at > now()`, runs.TokenHash(token)).
			Scan(&gr.runID, &gr.purpose, &gr.provider, &gr.sealed, &gr.budget, &gr.used, &gr.status)
	})
	return gr, err
}

func (g *Gateway) llm(w http.ResponseWriter, r *http.Request, provider string) {
	path := strings.TrimPrefix(r.URL.Path, "/"+provider)
	if !allowedRoute(provider, r.Method, path) {
		apiError(w, provider, http.StatusForbidden, "permission_error",
			r.Method+" "+path+" is not available through the arena gateway; allowed: "+strings.Join(llmRoutes[provider], ", "))
		return
	}
	token := tokenFrom(r)
	if token == "" {
		apiError(w, provider, http.StatusUnauthorized, "authentication_error", "missing run token")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxLLMBody+1))
	if err != nil || len(body) > maxLLMBody {
		apiError(w, provider, http.StatusRequestEntityTooLarge, "request_too_large", "the request body is too large or unreadable")
		return
	}
	if why := refusedBody(provider, path, body); why != "" {
		apiError(w, provider, http.StatusBadRequest, "invalid_request_error", why)
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	r.ContentLength = int64(len(body))
	// Wait for a slot before reading the budget, so each request sees what the ones before it spent.
	release, err := g.acquire(r.Context(), runs.TokenHash(token))
	if err != nil {
		return // the client went away while waiting
	}
	defer release()
	gr, err := g.lookup(r.Context(), token)
	if errors.Is(err, pgx.ErrNoRows) {
		apiError(w, provider, http.StatusUnauthorized, "authentication_error", "unknown or expired run token")
		return
	}
	if err != nil {
		g.log.Error("token lookup", "err", err)
		apiError(w, provider, http.StatusBadGateway, "api_error", "gateway database error")
		return
	}
	var realKey string
	switch gr.purpose {
	case "agent":
		if gr.status != "agent" {
			apiError(w, provider, http.StatusForbidden, "permission_error", "the run is no longer building")
			return
		}
		if gr.used >= gr.budget {
			apiError(w, provider, http.StatusTooManyRequests, "rate_limit_error", "token budget exhausted for this run")
			return
		}
		if gr.provider != provider {
			apiError(w, provider, http.StatusForbidden, "permission_error", "this agent's key is for "+gr.provider+", not "+provider)
			return
		}
		if realKey, err = g.box.Open(gr.sealed); err != nil {
			g.log.Error("open agent key", "run_id", gr.runID, "err", err)
			apiError(w, provider, http.StatusBadGateway, "api_error", "cannot open the agent's key")
			return
		}
	case "judge":
		if provider != "anthropic" || gr.status != "checking" {
			apiError(w, provider, http.StatusForbidden, "permission_error", "judge tokens are for anthropic while checking")
			return
		}
		if g.cfg.JudgeKey == "" && !g.cfg.FakeUpstream {
			apiError(w, provider, http.StatusServiceUnavailable, "judge_not_configured", "judge_not_configured: no ARENA_JUDGE_API_KEY on the gateway")
			return
		}
		realKey = g.cfg.JudgeKey
	}
	meter := &usage{}
	defer func() { g.record(gr, meter) }()

	if g.cfg.FakeUpstream {
		fake(w, body, provider, meter)
		return
	}
	target, _ := url.Parse(upstreams[provider])
	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.URL.Path = strings.TrimPrefix(pr.In.URL.Path, "/"+provider)
			pr.Out.URL.RawPath = ""
			pr.Out.Host = target.Host
			pr.Out.Header.Del("x-api-key")
			pr.Out.Header.Del("Authorization")
			pr.Out.Header.Del("X-Forwarded-For")
			if provider == "anthropic" {
				pr.Out.Header.Set("x-api-key", realKey)
			} else {
				pr.Out.Header.Set("Authorization", "Bearer "+realKey)
			}
		},
		ModifyResponse: func(resp *http.Response) error {
			if resp.StatusCode < 300 {
				sse := strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream")
				resp.Body = &meteredBody{ReadCloser: resp.Body, meter: meter, sse: sse}
			}
			return nil
		},
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			g.log.Warn("upstream", "provider", provider, "err", err)
			apiError(w, provider, http.StatusBadGateway, "api_error", "upstream unreachable")
		},
	}
	proxy.ServeHTTP(w, r)
}

// usage accumulates the token counts reported in one response. Streamed events repeat or grow the numbers
// (Anthropic's message_delta carries the cumulative output), so each field keeps its maximum.
type usage struct {
	mu                             sync.Mutex
	in, out, cacheRead, cacheWrite int64
	seen                           bool
}

func num(m map[string]any, k string) int64 {
	if v, ok := m[k].(float64); ok {
		return int64(v)
	}
	return 0
}

func (u *usage) observe(raw []byte) {
	var doc map[string]any
	if json.Unmarshal(raw, &doc) != nil {
		return
	}
	var us map[string]any
	for _, cand := range []any{doc["usage"], nested(doc, "message", "usage"), nested(doc, "response", "usage")} {
		if m, ok := cand.(map[string]any); ok {
			us = m
			break
		}
	}
	if us == nil {
		return
	}
	in := num(us, "input_tokens") + num(us, "prompt_tokens")
	out := num(us, "output_tokens") + num(us, "completion_tokens")
	cr := num(us, "cache_read_input_tokens")
	cw := num(us, "cache_creation_input_tokens")
	// OpenAI counts cached tokens inside the input.
	for _, k := range []string{"prompt_tokens_details", "input_tokens_details"} {
		if d, ok := us[k].(map[string]any); ok {
			c := num(d, "cached_tokens")
			cr += c
			in -= c
		}
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	u.seen = true
	u.in, u.out, u.cacheRead, u.cacheWrite = max(u.in, in), max(u.out, out), max(u.cacheRead, cr), max(u.cacheWrite, cw)
}

func nested(m map[string]any, keys ...string) any {
	var cur any = m
	for _, k := range keys {
		mm, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur = mm[k]
	}
	return cur
}

// meteredBody passes the response through untouched while reading usage out of it.
type meteredBody struct {
	io.ReadCloser
	meter *usage
	sse   bool
	buf   bytes.Buffer
	line  []byte
}

const maxMeteredJSON = 16 << 20

func (b *meteredBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	chunk := p[:n]
	if b.sse {
		for len(chunk) > 0 {
			i := bytes.IndexByte(chunk, '\n')
			if i < 0 {
				b.line = append(b.line, chunk...)
				break
			}
			b.line = append(b.line, chunk[:i]...)
			if data, ok := bytes.CutPrefix(bytes.TrimSpace(b.line), []byte("data:")); ok {
				b.meter.observe(bytes.TrimSpace(data))
			}
			b.line = b.line[:0]
			chunk = chunk[i+1:]
		}
	} else if b.buf.Len() < maxMeteredJSON {
		b.buf.Write(chunk)
	}
	return n, err
}

func (b *meteredBody) Close() error {
	if !b.sse && b.buf.Len() > 0 && b.buf.Len() < maxMeteredJSON {
		b.meter.observe(b.buf.Bytes())
	}
	return b.ReadCloser.Close()
}

func (g *Gateway) record(gr grant, u *usage) {
	u.mu.Lock()
	in, out, cr, cw, seen := u.in, u.out, u.cacheRead, u.cacheWrite, u.seen
	u.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var q string
	var args []any
	if gr.purpose == "judge" {
		q = `UPDATE runs SET judge_tokens_in = judge_tokens_in + $2, judge_tokens_out = judge_tokens_out + $3 WHERE id = $1`
		args = []any{gr.runID, in + cr + cw, out}
	} else {
		reqs := 0
		if seen {
			reqs = 1
		}
		q = `UPDATE runs SET tokens_in = tokens_in + $2, tokens_out = tokens_out + $3, tokens_cache_read = tokens_cache_read + $4,
			tokens_cache_write = tokens_cache_write + $5, llm_requests = llm_requests + $6, updated_at = now() WHERE id = $1`
		args = []any{gr.runID, in, out, cr, cw, reqs}
	}
	if err := g.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, q, args...)
		return err
	}); err != nil {
		g.log.Error("record usage", "run_id", gr.runID, "err", err)
	}
}

// registry proxies read-only package registry traffic. PyPI's pages link to files.pythonhosted.org, which the
// sandbox can't reach, so those links are rewritten to come back through here.
func (g *Gateway) registry(w http.ResponseWriter, r *http.Request, name string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "read-only registry mirror", http.StatusMethodNotAllowed)
		return
	}
	target, _ := url.Parse(upstreams[name])
	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.URL.Path = strings.TrimPrefix(pr.In.URL.Path, "/"+name)
			pr.Out.URL.RawPath = ""
			pr.Out.Host = target.Host
			pr.Out.Header.Del("Authorization")
			if name == "pypi" {
				pr.Out.Header.Set("Accept-Encoding", "identity")
			}
		},
		ModifyResponse: func(resp *http.Response) error {
			if name != "pypi" {
				return nil
			}
			body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
			resp.Body.Close()
			if err != nil {
				return err
			}
			body = bytes.ReplaceAll(body, []byte("https://files.pythonhosted.org/"), []byte(g.cfg.SelfURL+"/pyfiles/"))
			resp.Body = io.NopCloser(bytes.NewReader(body))
			resp.ContentLength = int64(len(body))
			resp.Header.Set("Content-Length", strconv.Itoa(len(body)))
			resp.Header.Del("Content-Encoding")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, "registry unreachable", http.StatusBadGateway)
		},
	}
	proxy.ServeHTTP(w, r)
}

// fake answers LLM calls without an upstream (ARENA_GATEWAY_FAKE=true, local runs without keys). For the judge it
// plays a two-step session (look at the home page, then a verdict) so the whole pipeline can be clicked through.
func fake(w http.ResponseWriter, body []byte, provider string, meter *usage) {
	var req struct {
		Model    string            `json:"model"`
		Messages []json.RawMessage `json:"messages"`
		Tools    []struct {
			Name string `json:"name"`
		} `json:"tools"`
	}
	_ = json.Unmarshal(body, &req)
	meter.observe([]byte(`{"usage":{"input_tokens":` + strconv.Itoa(len(body)/4) + `,"output_tokens":40}}`))
	w.Header().Set("Content-Type", "application/json")
	if provider == "openai" {
		_, _ = w.Write([]byte(`{"id":"fake","object":"chat.completion","model":"fake","choices":[{"index":0,"message":{"role":"assistant","content":"fake upstream"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}`))
		return
	}
	judge := false
	for _, t := range req.Tools {
		if t.Name == "submit_verdict" {
			judge = true
		}
	}
	content := []any{map[string]any{"type": "text", "text": "fake upstream: no real model was called"}}
	stop := "end_turn"
	if judge {
		stop = "tool_use"
		if len(req.Messages) < 3 {
			content = []any{map[string]any{"type": "tool_use", "id": "toolu_fake1", "name": "browser_goto", "input": map[string]any{"path": "/"}}}
		} else {
			content = []any{map[string]any{"type": "tool_use", "id": "toolu_fake2", "name": "submit_verdict", "input": map[string]any{
				"summary": "Fake judge (ARENA_GATEWAY_FAKE): no model was called, these points are placeholders.",
				"criteria": []any{
					map[string]any{"title": "Functionality", "max": 60, "points": 30, "note": "placeholder"},
					map[string]any{"title": "UI and UX", "max": 25, "points": 15, "note": "placeholder"},
					map[string]any{"title": "Code", "max": 15, "points": 10, "note": "placeholder"},
				}}}}
		}
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id": "msg_fake", "type": "message", "role": "assistant", "model": req.Model, "content": content,
		"stop_reason": stop, "stop_sequence": nil,
		"usage": map[string]any{"input_tokens": len(body) / 4, "output_tokens": 40},
	})
}
