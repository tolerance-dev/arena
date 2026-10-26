// Package gateway is the only way out of a sandbox. Agents on their run's internal network
// reach it as http://gateway:8090:
//
//   - /anthropic/*, /openai/*, /gemini/*: LLM APIs by protocol, only the generation endpoints (allowedRoute). The
//     agent's provider (providers) says where each protocol goes: Anthropic, OpenAI and Google directly, or OrcaRouter
//     for all three. The run token the sandbox holds
//     is swapped for the agent's real key, usage is counted into the run, and the run's token budget is enforced
//     with reservations for the requests in flight (budget.go); a run has at most maxParallel of them (more wait
//     their turn).
//   - /npm/*, /pypi/*, /pyfiles/*: read-only package registries, so agents can install dependencies.
//
// Nothing else is proxied.
package gateway

import (
	"bytes"
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
	// Subscriptions passes agents keyed with a personal Claude or ChatGPT subscription (ARENA_SUBSCRIPTIONS; the
	// api lets only admins create them).
	Subscriptions bool
	FakeUpstream  bool   // answer LLM calls locally (dev without keys)
	SelfURL       string // how sandboxes reach the gateway, for rewriting PyPI links
}

type Gateway struct {
	store store
	box   *secretbox.Box
	cfg   Config
	log   *slog.Logger
	// upstream replaces every provider's address (tests).
	upstream string

	mu       sync.Mutex
	accounts map[string]*account // by token hash
}

func New(pool *db.Pool, box *secretbox.Box, cfg Config, log *slog.Logger) *Gateway {
	return &Gateway{store: pgStore{pool}, box: box, cfg: cfg, log: log.With("component", "gateway"), accounts: map[string]*account{}}
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
	runID, provider string // provider: the run's, fixed at creation (runs.Manifest)
	keyProvider     string // the agent's key's now: a key switched to another provider mid-run is refused
	sealed          []byte
	budget, used    int64
	status          string
	closed          bool // the gateway closed the budget (agent_exit = budget)
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
	p := planFor(provider, r.Method, path, body)

	acc, leave := g.join(runs.TokenHash(token))
	defer leave()
	// Wait for a slot first: at most maxParallel requests of a run hold reservations at once.
	select {
	case acc.slots <- struct{}{}:
	case <-r.Context().Done():
		return // the client went away while waiting
	}
	defer func() { <-acc.slots }()
	var realKey, base string
	vet := func(gr grant) *refusal {
		switch {
		case gr.status != "agent":
			return &refusal{http.StatusForbidden, "permission_error", "the run is no longer building"}
		case gr.keyProvider != gr.provider:
			return &refusal{http.StatusForbidden, "permission_error", "the agent's key was switched to " + gr.keyProvider + " after this run started on " + gr.provider}
		case subscription(gr.provider) && !g.cfg.Subscriptions:
			return &refusal{http.StatusForbidden, "permission_error", "subscriptions are off on this gateway"}
		}
		if base = providers[gr.provider][provider]; base == "" {
			return &refusal{http.StatusForbidden, "permission_error", "this agent's key is for " + gr.provider + ", which doesn't speak the " + provider + " protocol"}
		}
		var err error
		if realKey, err = g.box.Open(gr.sealed); err != nil {
			g.log.Error("open agent key", "run_id", gr.runID, "err", err)
			return &refusal{http.StatusBadGateway, "api_error", "cannot open the agent's key"}
		}
		return nil
	}
	gr, res, err := g.admit(r.Context(), acc, token, p, vet)
	var no *refusal
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		apiError(w, provider, http.StatusUnauthorized, "authentication_error", "unknown or expired run token")
		return
	case errors.As(err, &no):
		apiError(w, provider, no.status, no.kind, no.msg)
		return
	case r.Context().Err() != nil:
		return // the client went away while waiting
	case err != nil:
		g.log.Error("token lookup", "err", err)
		apiError(w, provider, http.StatusBadGateway, "api_error", "gateway database error")
		return
	}
	meter := &usage{model: requestedModel(provider, path, body)}
	defer func() { g.settle(acc, gr, res, meter) }()
	body = p.body
	r.Body = io.NopCloser(bytes.NewReader(body))
	r.ContentLength = int64(len(body))

	if g.cfg.FakeUpstream {
		fake(w, r, body, provider, path, meter)
		return
	}
	if g.upstream != "" {
		base = g.upstream
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
			case gr.provider == "claude-sub":
				// Claude Code's OAuth token from `claude setup-token`.
				pr.Out.Header.Set("Authorization", "Bearer "+realKey)
				pr.Out.Header.Set("anthropic-beta", strings.Trim(pr.In.Header.Get("anthropic-beta")+",oauth-2025-04-20", ","))
			case gr.provider == "chatgpt-sub":
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
		ModifyResponse: func(resp *http.Response) error {
			// Written before the answer reaches the agent, which may exit on it at once.
			if keyRejected(provider, resp) {
				g.log.Warn("provider rejected the key", "run_id", gr.runID, "provider", gr.provider, "status", resp.StatusCode)
				if err := g.store.rejectKey(resp.Request.Context(), gr.runID); err != nil {
					g.log.Error("record rejected key", "run_id", gr.runID, "err", err)
				}
			}
			return meterResponse(meter)(resp)
		},
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			g.log.Warn("upstream", "provider", provider, "err", err)
			if unsent(err) {
				meter.mu.Lock()
				meter.unsent = true
				meter.mu.Unlock()
			}
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
// keyRejected says the provider refused the key itself: 401 everywhere, and Gemini's 400 API_KEY_INVALID. A
// Gemini 400 body is read (it is small) and put back for the agent.
func keyRejected(protocol string, resp *http.Response) bool {
	if resp.StatusCode == http.StatusUnauthorized {
		return true
	}
	if protocol != "gemini" || resp.StatusCode != http.StatusBadRequest {
		return false
	}
	head, err := io.ReadAll(io.LimitReader(resp.Body, 16<<10))
	resp.Body = struct {
		io.Reader
		io.Closer
	}{io.MultiReader(bytes.NewReader(head), resp.Body), resp.Body}
	return err == nil && bytes.Contains(head, []byte("API_KEY_INVALID"))
}

func meterResponse(meter *usage) func(*http.Response) error {
	return func(resp *http.Response) error {
		meter.mu.Lock()
		meter.status = resp.StatusCode
		meter.mu.Unlock()
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
	model                          string // the model the request asked for (requestedModel), "" = unknown
	status                         int    // the upstream's answer, 0 = none
	complete                       bool   // the response body was read to its end
	unsent                         bool   // the request never reached the provider
}

// charge is what a finished request costs the run, and the input it reported. Missing usage is not zero: a
// successful response cut short, or one that never said what it used, is charged its reservation for what it didn't
// report.
func (u *usage) charge(res reservation) (c spent, seenIn int64, model string) {
	u.mu.Lock()
	defer u.mu.Unlock()
	c = spent{in: u.in, out: u.out, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite}
	switch {
	case u.unsent:
		c = spent{}
	case u.status >= 300:
		// An error answer: providers bill what it reports, usually nothing.
	case u.seen && u.complete:
	default:
		if !u.seen {
			c.in = res.in
		}
		c.out = max(c.out, res.out)
	}
	if u.seen || c.budgeted() > 0 {
		c.requests = 1
	}
	if u.seen {
		model = u.model // only metered requests count: an upstream error or a token count is no use of a model
	}
	return c, u.in + u.cacheRead + u.cacheWrite, model
}

func (u *usage) finished(status int) {
	u.mu.Lock()
	u.status, u.complete = status, true
	u.mu.Unlock()
}

// modelName is what a model id may look like to be recorded: it comes from the agent and shows on the site.
var modelName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$`)

// requestedModel is the model a generation request asks for: Gemini names it in the path, the others in the body.
func requestedModel(protocol, path string, body []byte) string {
	var m string
	if protocol == "gemini" {
		if sm := geminiPath.FindStringSubmatch(path); sm != nil {
			m = sm[1]
		}
	} else {
		var req struct {
			Model string `json:"model"`
		}
		_ = json.Unmarshal(body, &req)
		m = req.Model
	}
	if !modelName.MatchString(m) {
		return ""
	}
	return m
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
	if err == io.EOF {
		b.meter.mu.Lock()
		b.meter.complete = true
		b.meter.mu.Unlock()
	}
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
// end for free.
func fake(w http.ResponseWriter, r *http.Request, body []byte, provider, path string, meter *usage) {
	var req struct {
		Model  string `json:"model"`
		Stream bool   `json:"stream"`
	}
	_ = json.Unmarshal(body, &req)
	defer meter.finished(http.StatusOK)
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
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id": "msg_fake", "type": "message", "role": "assistant", "model": req.Model,
		"content": []any{map[string]any{"type": "text", "text": text}}, "stop_reason": "end_turn", "stop_sequence": nil,
		"usage": map[string]any{"input_tokens": len(body) / 4, "output_tokens": 40},
	})
}
