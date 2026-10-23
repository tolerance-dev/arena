package gateway

import "testing"

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
