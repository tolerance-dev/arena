package sanitize

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// Agent logs are public (the run page shows them live): every secret an agent can print must come out redacted.
func TestCleanLogRedactsSecrets(t *testing.T) {
	cases := []struct {
		name, in, secret string
	}{
		{"run token", "OPENAI_API_KEY=arena-run-0f47c7ee5a1b2c3d4e5f60718293a4b5c6d7e8f901234567", "0f47c7ee5a1b2c3d"},
		{"run token in a curl line", "curl -H 'x-api-key: arena-run-9a8b7c6d5e4f30211203f4e5d6c7b8a9f0e1d2c3b4a59687'", "9a8b7c6d5e4f3021"},
		{"anthropic key", "using sk-ant-api03-AbCdEfGh12345678IjKlMnOp", "AbCdEfGh12345678"},
		{"openai project key", "key sk-proj-Zx9Yw8Vu7Ts6Rq5Po4Nm3", "Zx9Yw8Vu7Ts6"},
		{"github token", "push with ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8", "a1B2c3D4e5F6"},
		{"bearer header", "Authorization: Bearer abc.def.ghi-not-a-word", "abc.def.ghi"},
		{"jwt", "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig", "eyJzdWIiOiIxMjM0NTY3ODkwIn0"},
		{"secret assignment", "DB_PASSWORD=hunter2", "hunter2"},
		{"api key in json", `"api_key": "plainvalue"`, "plainvalue"},
		{"camel-case key in json", `{"apiKey":"plainvalue"}`, "plainvalue"},
		{"aws key id", "aws AKIAIOSFODNN7EXAMPLE configured", "AKIAIOSFODNN7EXAMPLE"},
		{"pem block", "-----BEGIN PRIVATE KEY----- MIIEvQIBADANBg", "MIIEvQIBADANBg"},
		{"long base64 blob", "blob QmFzZTY0RW5jb2RlZFNlY3JldDEyMzQ1Njc4OTBhYmNkZWY=", "QmFzZTY0RW5jb2RlZFNlY3JldDEy"},
	}
	for _, c := range cases {
		got := CleanLog(c.in, 1<<20)
		if strings.Contains(got, c.secret) {
			t.Errorf("%s: %q kept the secret: %q", c.name, c.in, got)
		}
		if !strings.Contains(got, redacted) {
			t.Errorf("%s: %q has no %s: %q", c.name, c.in, redacted, got)
		}
	}
}

// What an agent's log is mostly made of must survive, or the log is useless.
func TestCleanLogKeepsOrdinaryOutput(t *testing.T) {
	for _, line := range []string{
		"npm install express@4.21.2",
		"wrote /work/src/components/ProductListPageWithFiltersAndSorting.tsx",
		"GET /api/products?category=shoes 200 12ms",
		"listening on http://0.0.0.0:3000",
		"Tokens used: 62,169",
		"deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", // hex without a digit is a word, not a key
	} {
		if got := CleanLog(line, 1<<20); got != line {
			t.Errorf("%q became %q", line, got)
		}
	}
}

func TestCleanLogStripsTerminalCodes(t *testing.T) {
	got := CleanLog("\x1b[32mok\x1b[0m\tdone\r\n\x07next​", 1<<20)
	if want := "ok\tdone\nnext"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// The end of a log is where the failure is: a long log keeps its tail, cut on a rune boundary.
func TestCleanLogKeepsTheTail(t *testing.T) {
	got := CleanLog(strings.Repeat("ё", 100)+"\nfailed: exit 1", 20)
	if len(got) > 20 || !utf8.ValidString(got) || !strings.HasSuffix(got, "failed: exit 1") {
		t.Errorf("got %q", got)
	}
}
