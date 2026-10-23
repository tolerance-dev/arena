// Package gateway is the only way out of a sandbox. Agents (and the judge) on their run's internal network
// reach it as http://gateway:8090:
//
//   - /anthropic/*, /openai/*, /gemini/*: LLM APIs by protocol, only the generation endpoints (allowedRoute). The
//     agent's provider (providers) says where each protocol goes: Anthropic, OpenAI and Google directly, or OrcaRouter
//     for all three. The run token the sandbox holds
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
	"regexp"
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
	JudgeKey string // Anthropic key the judge spends; "" = judging off
	JudgeURL string // where the judge's Anthropic requests go ("" = api.anthropic.com), e.g. https://api.orcarouter.ai
	// Subscriptions passes agents keyed with a personal Claude or ChatGPT subscription (ARENA_SUBSCRIPTIONS, local
	// only; the api lets only admins create them).
	Subscriptions bool
	FakeUpstream  bool   // answer LLM calls locally (dev without keys)
	SelfURL       string // how sandboxes reach the gateway, for rewriting PyPI links
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

// llmRoutes are the only LLM endpoints proxied, by protocol: generation (metered from its response), token counting
// and model lists. Everything else (batches, files, assistants, fine-tuning, caches, …) would spend the key without a
// usage figure in the response, or outlive the run.
var llmRoutes = map[string][]string{
	"anthropic": {"POST /v1/messages", "POST /v1/messages/count_tokens", "GET /v1/models", "GET /v1/models/*"},
	"openai":    {"POST /v1/chat/completions", "POST /v1/responses", "GET /v1/models", "GET /v1/models/*"},
	"gemini":    {"POST /v1beta/models/{model}:generateContent|streamGenerateContent|countTokens", "GET /v1beta/models"},
	// Codex on a ChatGPT subscription: the Responses API under chatgpt.com/backend-api/codex.
	"chatgpt": {"POST /responses", "GET /models"},
}

// geminiPath is a Gemini model call; the model may carry a vendor prefix (OrcaRouter's google/gemini-…).
var geminiPath = regexp.MustCompile(`^/v1(?:beta)?/models/((?:[A-Za-z0-9._-]+/)?[A-Za-z0-9._-]+):(generateContent|streamGenerateContent|countTokens)$`)
var geminiModels = regexp.MustCompile(`^/v1(?:beta)?/models(?:/(?:[A-Za-z0-9._-]+/)?[A-Za-z0-9._-]+)?$`)

func allowedRoute(protocol, method, path string) bool {
	if protocol == "gemini" {
		return (method == http.MethodPost && geminiPath.MatchString(path)) || (method == http.MethodGet && geminiModels.MatchString(path))
	}
	for _, r := range llmRoutes[protocol] {
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

const orcaRouter = "https://api.orcarouter.ai"

// providers maps an agent's provider to where each protocol the sandbox speaks goes. A protocol a provider lacks is
// refused (an Anthropic key can't be spent through /openai).
var providers = map[string]map[string]string{
	"anthropic":  {"anthropic": "https://api.anthropic.com"},
	"openai":     {"openai": "https://api.openai.com"},
	"google":     {"gemini": "https://generativelanguage.googleapis.com"},
	"orcarouter": {"anthropic": orcaRouter, "openai": orcaRouter, "gemini": orcaRouter},
	// Personal subscriptions (Config.Subscriptions): Claude Code's OAuth token, Codex's ChatGPT sign-in.
	"claude-sub":  {"anthropic": "https://api.anthropic.com"},
	"chatgpt-sub": {"chatgpt": "https://chatgpt.com/backend-api/codex"},
}

func subscription(provider string) bool { return provider == "claude-sub" || provider == "chatgpt-sub" }

// chatgptBody: the ChatGPT backend keeps nothing (store must be false).
func chatgptBody(protocol string, body []byte) []byte {
	if protocol != "chatgpt" {
		return body
	}
	var req map[string]json.RawMessage
	if json.Unmarshal(body, &req) != nil {
		return body
	}
	req["store"] = json.RawMessage("false")
	out, err := json.Marshal(req)
	if err != nil {
		return body
	}
	return out
}

// upstreamPath is the path sent upstream. OrcaRouter names Gemini models google/gemini-…, while Gemini CLI also
// calls its helper models by their bare names, so those get the prefix here.
func upstreamPath(provider, protocol, path string) string {
	if provider == "orcarouter" && protocol == "gemini" {
		if m := geminiPath.FindStringSubmatchIndex(path); m != nil && !strings.Contains(path[m[2]:m[3]], "/") {
			return path[:m[2]] + "google/" + path[m[2]:]
		}
	}
	return path
}

// withStreamUsage asks for usage in a streamed OpenAI chat completion: without stream_options.include_usage the
// stream carries no token counts and the run would build unmetered.
func withStreamUsage(protocol, path string, body []byte) []byte {
	if protocol != "openai" || path != "/v1/chat/completions" {
		return body
	}
	var req map[string]json.RawMessage
	if json.Unmarshal(body, &req) != nil || string(req["stream"]) != "true" {
		return body
	}
	var opts map[string]any
	_ = json.Unmarshal(req["stream_options"], &opts)
	if opts == nil {
		opts = map[string]any{}
	}
	opts["include_usage"] = true
	raw, err := json.Marshal(opts)
	if err != nil {
		return body
	}
	req["stream_options"] = raw
	out, err := json.Marshal(req)
	if err != nil {
		return body
	}
	return out
}

var upstreams = map[string]string{
	"npm":     "https://registry.npmjs.org",
	"pypi":    "https://pypi.org",
	"pyfiles": "https://files.pythonhosted.org",
}

func (g *Gateway) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("ok")) })
	mux.HandleFunc("/anthropic/", func(w http.ResponseWriter, r *http.Request) { g.llm(w, r, "anthropic") })
	mux.HandleFunc("/openai/", func(w http.ResponseWriter, r *http.Request) { g.llm(w, r, "openai") })
	mux.HandleFunc("/gemini/", func(w http.ResponseWriter, r *http.Request) { g.llm(w, r, "gemini") })
	mux.HandleFunc("/chatgpt/", func(w http.ResponseWriter, r *http.Request) { g.llm(w, r, "chatgpt") })
	for _, name := range []string{"npm", "pypi", "pyfiles"} {
		mux.HandleFunc("/"+name+"/", func(w http.ResponseWriter, r *http.Request) { g.registry(w, r, name) })
	}
	return mux
}

func apiError(w http.ResponseWriter, provider string, status int, kind, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if provider == "gemini" {
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": status, "message": msg, "status": kind}})
		return
	}
	if provider == "openai" || provider == "chatgpt" {
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
	if k := r.Header.Get("x-goog-api-key"); k != "" {
		return k
	}
	if k := r.URL.Query().Get("key"); k != "" {
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
	// A WebSocket (Codex's responses transport) would tunnel straight through the proxy with no usage read out of
	// it: refuse the upgrade, and the client falls back to HTTP streaming, which is metered.
	if r.Header.Get("Upgrade") != "" {
		apiError(w, provider, http.StatusUpgradeRequired, "invalid_request_error",
			"WebSockets are not available through the arena gateway; use HTTP streaming")
		return
	}
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
	body = chatgptBody(provider, withStreamUsage(provider, path, body))
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
	var realKey, base string
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
		if subscription(gr.provider) && !g.cfg.Subscriptions {
			apiError(w, provider, http.StatusForbidden, "permission_error", "subscriptions are off on this gateway")
			return
		}
		if base = providers[gr.provider][provider]; base == "" {
			apiError(w, provider, http.StatusForbidden, "permission_error", "this agent's key is for "+gr.provider+", which doesn't speak the "+provider+" protocol")
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
		realKey, base = g.cfg.JudgeKey, g.cfg.JudgeURL
		if base == "" {
			base = providers["anthropic"]["anthropic"]
		}
	}
	meter := &usage{}
	defer func() { g.record(gr, meter) }()

	if g.cfg.FakeUpstream {
		fake(w, r, body, provider, path, meter)
		return
	}
	target, _ := url.Parse(base)
	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.URL.Path = target.Path + upstreamPath(gr.provider, provider, path)
			pr.Out.URL.RawPath = ""
			if q := pr.Out.URL.Query(); q.Has("key") {
				q.Del("key")
				pr.Out.URL.RawQuery = q.Encode()
			}
			pr.Out.Host = target.Host
			pr.Out.Header.Del("x-api-key")
			pr.Out.Header.Del("x-goog-api-key")
			pr.Out.Header.Del("Authorization")
			pr.Out.Header.Del("X-Forwarded-For")
			plainResponses(pr.Out.Header)
			switch {
			case gr.purpose == "agent" && gr.provider == "claude-sub":
				// Claude Code's OAuth token from `claude setup-token`.
				pr.Out.Header.Set("Authorization", "Bearer "+realKey)
				pr.Out.Header.Set("anthropic-beta", strings.Trim(pr.In.Header.Get("anthropic-beta")+",oauth-2025-04-20", ","))
			case gr.purpose == "agent" && gr.provider == "chatgpt-sub":
				var tok struct {
					AccessToken string `json:"access_token"`
					AccountID   string `json:"account_id"`
				}
				_ = json.Unmarshal([]byte(realKey), &tok)
				pr.Out.Header.Set("Authorization", "Bearer "+tok.AccessToken)
				pr.Out.Header.Set("chatgpt-account-id", tok.AccountID)
				pr.Out.Header.Set("OpenAI-Beta", "responses=experimental")
				pr.Out.Header.Set("originator", "codex_cli_rs")
			case provider == "anthropic":
				pr.Out.Header.Set("x-api-key", realKey)
			case provider == "gemini":
				pr.Out.Header.Set("x-goog-api-key", realKey)
			default:
				pr.Out.Header.Set("Authorization", "Bearer "+realKey)
			}
		},
		ModifyResponse: meterResponse(meter),
		FlushInterval:  -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			g.log.Warn("upstream", "provider", provider, "err", err)
			apiError(w, provider, http.StatusBadGateway, "api_error", "upstream unreachable")
		},
	}
	proxy.ServeHTTP(w, r)
}

// plainResponses drops the client's Accept-Encoding: a compressed response can't be read for usage, so a client
// asking for gzip/br/zstd would build unmetered. Go's transport then negotiates gzip itself and hands back plain bytes.
func plainResponses(h http.Header) { h.Del("Accept-Encoding") }

// meterResponse reads usage out of a successful response as it streams through, and refuses one that still comes
// back encoded (nothing could be counted from it).
func meterResponse(meter *usage) func(*http.Response) error {
	return func(resp *http.Response) error {
		if resp.StatusCode >= 300 {
			return nil
		}
		if enc := resp.Header.Get("Content-Encoding"); enc != "" && enc != "identity" {
			return errors.New("upstream sent an encoded response (" + enc + "): usage can't be metered")
		}
		sse := strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream")
		resp.Body = &meteredBody{ReadCloser: resp.Body, meter: meter, sse: sse}
		return nil
	}
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
		// A Gemini stream without alt=sse is one JSON array of chunks.
		var docs []json.RawMessage
		if json.Unmarshal(raw, &docs) == nil {
			for _, d := range docs {
				u.observe(d)
			}
		}
		return
	}
	if gm, ok := doc["usageMetadata"].(map[string]any); ok {
		// Gemini: the prompt count includes the cached part; thinking is billed as output.
		cr := num(gm, "cachedContentTokenCount")
		u.add(num(gm, "promptTokenCount")-cr, num(gm, "candidatesTokenCount")+num(gm, "thoughtsTokenCount"), cr, 0)
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
	u.add(in, out, cr, cw)
}

func (u *usage) add(in, out, cr, cw int64) {
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
	meter   *usage
	sse     bool
	sniffed bool // the first bytes were looked at: an event stream is one even without its Content-Type
	buf     bytes.Buffer
	line    []byte
}

const maxMeteredJSON = 16 << 20

func (b *meteredBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	chunk := p[:n]
	if !b.sniffed && n > 0 {
		// chatgpt.com's Codex backend streams events with no Content-Type: read as JSON, they'd go unmetered.
		b.sniffed = true
		head := bytes.TrimLeft(chunk, " \t\r\n")
		if !b.sse && (bytes.HasPrefix(head, []byte("event:")) || bytes.HasPrefix(head, []byte("data:"))) {
			b.sse = true
		}
	}
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

// fake answers LLM calls without an upstream (ARENA_GATEWAY_FAKE=true, local runs without keys): one short text
// answer in each protocol's shape, streamed when the client asked for a stream, so every agent CLI can be run end to
// end for free. For the judge it plays a two-step session (look at the home page, then a verdict) so the whole
// pipeline can be clicked through.
func fake(w http.ResponseWriter, r *http.Request, body []byte, provider, path string, meter *usage) {
	var req struct {
		Model    string            `json:"model"`
		Stream   bool              `json:"stream"`
		Messages []json.RawMessage `json:"messages"`
		Tools    []struct {
			Name string `json:"name"`
		} `json:"tools"`
	}
	_ = json.Unmarshal(body, &req)
	in := len(body) / 4
	meter.observe([]byte(`{"usage":{"input_tokens":` + strconv.Itoa(in) + `,"output_tokens":40}}`))
	const text = "fake upstream: no real model was called"
	sse := func(events ...any) {
		w.Header().Set("Content-Type", "text/event-stream")
		for _, e := range events {
			if s, ok := e.(string); ok {
				_, _ = io.WriteString(w, s)
				continue
			}
			b, _ := json.Marshal(e)
			_, _ = io.WriteString(w, "data: "+string(b)+"\n\n")
		}
	}
	switch {
	case provider == "gemini":
		chunk := map[string]any{
			"candidates":    []any{map[string]any{"content": map[string]any{"role": "model", "parts": []any{map[string]any{"text": text}}}, "finishReason": "STOP", "index": 0}},
			"usageMetadata": map[string]any{"promptTokenCount": in, "candidatesTokenCount": 40, "totalTokenCount": in + 40},
			"modelVersion":  "fake",
		}
		switch {
		case strings.HasSuffix(path, ":countTokens"):
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"totalTokens": in})
		case strings.HasSuffix(path, ":streamGenerateContent") && r.URL.Query().Get("alt") == "sse":
			sse(chunk)
		case strings.HasSuffix(path, ":streamGenerateContent"):
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]any{chunk})
		default:
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(chunk)
		}
		return
	case (provider == "openai" && path == "/v1/responses") || (provider == "chatgpt" && path == "/responses"):
		item := map[string]any{"id": "msg_fake", "type": "message", "status": "completed", "role": "assistant",
			"content": []any{map[string]any{"type": "output_text", "text": text, "annotations": []any{}}}}
		resp := map[string]any{"id": "resp_fake", "object": "response", "created_at": time.Now().Unix(), "model": req.Model,
			"status": "completed", "output": []any{item},
			"usage": map[string]any{"input_tokens": in, "output_tokens": 40, "total_tokens": in + 40}}
		if !req.Stream {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(resp)
			return
		}
		started := map[string]any{"id": "resp_fake", "object": "response", "model": req.Model, "status": "in_progress", "output": []any{}}
		ev := func(typ string, f map[string]any) string {
			f["type"] = typ
			b, _ := json.Marshal(f)
			return "event: " + typ + "\ndata: " + string(b) + "\n\n"
		}
		sse(ev("response.created", map[string]any{"response": started}),
			ev("response.output_item.added", map[string]any{"output_index": 0, "item": map[string]any{"id": "msg_fake", "type": "message", "role": "assistant", "content": []any{}}}),
			ev("response.output_text.delta", map[string]any{"item_id": "msg_fake", "output_index": 0, "content_index": 0, "delta": text}),
			ev("response.output_item.done", map[string]any{"output_index": 0, "item": item}),
			ev("response.completed", map[string]any{"response": resp}))
		return
	case provider == "openai":
		if req.Stream {
			sse(map[string]any{"id": "fake", "object": "chat.completion.chunk", "model": req.Model,
				"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"role": "assistant", "content": text}, "finish_reason": nil}}},
				map[string]any{"id": "fake", "object": "chat.completion.chunk", "model": req.Model,
					"choices": []any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": "stop"}}},
				map[string]any{"id": "fake", "object": "chat.completion.chunk", "model": req.Model, "choices": []any{},
					"usage": map[string]any{"prompt_tokens": in, "completion_tokens": 40, "total_tokens": in + 40}},
				"data: [DONE]\n\n")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "fake", "object": "chat.completion", "model": req.Model,
			"choices": []any{map[string]any{"index": 0, "message": map[string]any{"role": "assistant", "content": text}, "finish_reason": "stop"}},
			"usage":   map[string]any{"prompt_tokens": in, "completion_tokens": 40}})
		return
	}
	w.Header().Set("Content-Type", "application/json")
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
		// The agent judge browses first; the screens judge has only submit_verdict and answers at once.
		if len(req.Messages) < 3 && len(req.Tools) > 1 {
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
