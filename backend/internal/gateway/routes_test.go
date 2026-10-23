package gateway

import (
	"strings"
	"testing"
)

// Endpoints whose responses carry no usage (batches, files, background responses) would spend the key unmetered.
func TestAllowedRoute(t *testing.T) {
	cases := []struct {
		provider, method, path string
		want                   bool
	}{
		{"anthropic", "POST", "/v1/messages", true},
		{"anthropic", "POST", "/v1/messages/count_tokens", true},
		{"anthropic", "GET", "/v1/models/claude-opus-5-5", true},
		{"anthropic", "POST", "/v1/messages/batches", false},
		{"anthropic", "GET", "/v1/messages/batches/x/results", false},
		{"anthropic", "POST", "/v1/files", false},
		{"anthropic", "GET", "/v1/messages", false},
		{"anthropic", "GET", "/v1/models/a/b", false},
		{"openai", "POST", "/v1/responses", true},
		{"openai", "POST", "/v1/chat/completions", true},
		{"openai", "GET", "/v1/responses/resp_1", false},
		{"openai", "POST", "/v1/batches", false},
		{"openai", "POST", "/v1/messages", false},
	}
	for _, c := range cases {
		if got := allowedRoute(c.provider, c.method, c.path); got != c.want {
			t.Errorf("%s %s %s: got %v, want %v", c.provider, c.method, c.path, got, c.want)
		}
	}
	if refusedBody("openai", "/v1/responses", []byte(`{"model":"x","background":true}`)) == "" {
		t.Error("a background response must be refused")
	}
	if refusedBody("openai", "/v1/responses", []byte(`{"model":"x","stream":true}`)) != "" {
		t.Error("a streamed response must pass")
	}
}

func TestGeminiRoutes(t *testing.T) {
	cases := []struct {
		method, path string
		want         bool
	}{
		{"POST", "/v1beta/models/gemini-3.5-flash:generateContent", true},
		{"POST", "/v1beta/models/gemini-3.5-flash:streamGenerateContent", true},
		{"POST", "/v1beta/models/google/gemini-3.5-flash:countTokens", true},
		{"GET", "/v1beta/models", true},
		{"POST", "/v1beta/models/gemini-3.5-flash:batchGenerateContent", false},
		{"POST", "/v1beta/cachedContents", false},
		{"POST", "/v1beta/files", false},
		{"POST", "/v1beta/models/a/b/c:generateContent", false},
	}
	for _, c := range cases {
		if got := allowedRoute("gemini", c.method, c.path); got != c.want {
			t.Errorf("gemini %s %s: got %v, want %v", c.method, c.path, got, c.want)
		}
	}
	if got := upstreamPath("orcarouter", "gemini", "/v1beta/models/gemini-3.5-flash:generateContent"); got != "/v1beta/models/google/gemini-3.5-flash:generateContent" {
		t.Errorf("orcarouter prefix: %s", got)
	}
	if got := upstreamPath("orcarouter", "gemini", "/v1beta/models/google/gemini-3.5-flash:generateContent"); got != "/v1beta/models/google/gemini-3.5-flash:generateContent" {
		t.Errorf("an already prefixed model must stay: %s", got)
	}
	if got := upstreamPath("google", "gemini", "/v1beta/models/gemini-3.5-flash:generateContent"); got != "/v1beta/models/gemini-3.5-flash:generateContent" {
		t.Errorf("google must stay: %s", got)
	}
}

// Gemini reports usageMetadata (cached tokens inside the prompt count, thinking billed as output), in SSE chunks or
// as one JSON array of chunks.
func TestGeminiUsage(t *testing.T) {
	u := &usage{}
	u.observe([]byte(`{"usageMetadata":{"promptTokenCount":1000,"cachedContentTokenCount":400,"candidatesTokenCount":50,"thoughtsTokenCount":30}}`))
	if u.in != 600 || u.out != 80 || u.cacheRead != 400 {
		t.Errorf("got in=%d out=%d cr=%d", u.in, u.out, u.cacheRead)
	}
	a := &usage{}
	a.observe([]byte(`[{"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":5}},{"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":20}}]`))
	if a.in != 100 || a.out != 20 {
		t.Errorf("array: got in=%d out=%d", a.in, a.out)
	}
}

// A streamed chat completion carries usage only when asked, so the gateway asks for it.
func TestStreamUsageForced(t *testing.T) {
	out := string(withStreamUsage("openai", "/v1/chat/completions", []byte(`{"model":"m","stream":true,"stream_options":{"x":1}}`)))
	if !strings.Contains(out, `"include_usage":true`) || !strings.Contains(out, `"x":1`) {
		t.Errorf("got %s", out)
	}
	in := `{"model":"m","stream":false}`
	if got := string(withStreamUsage("openai", "/v1/chat/completions", []byte(in))); got != in {
		t.Errorf("non-streamed body changed: %s", got)
	}
	if got := string(withStreamUsage("openai", "/v1/responses", []byte(`{"stream":true}`))); got != `{"stream":true}` {
		t.Errorf("responses body changed: %s", got)
	}
}

// Codex on a ChatGPT subscription reaches only the Responses API, and never asks the backend to store anything.
func TestChatGPTSubscription(t *testing.T) {
	if !allowedRoute("chatgpt", "POST", "/responses") || allowedRoute("chatgpt", "POST", "/files") {
		t.Error("chatgpt routes")
	}
	if got := string(chatgptBody("chatgpt", []byte(`{"model":"m","store":true}`))); !strings.Contains(got, `"store":false`) {
		t.Errorf("store not forced off: %s", got)
	}
	if got := string(chatgptBody("openai", []byte(`{"store":true}`))); got != `{"store":true}` {
		t.Errorf("openai body changed: %s", got)
	}
}
