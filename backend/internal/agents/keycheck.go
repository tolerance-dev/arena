package agents

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"tolerance/internal/platform/httpx"
)

// keyKind refuses a key pasted under the wrong kind: a `claude setup-token` token as an Anthropic API key or back.
func keyKind(provider, key string) error {
	switch {
	case provider == "anthropic" && strings.HasPrefix(key, "sk-ant-oat"):
		return httpx.New(http.StatusBadRequest, "key_is_subscription", "That's a Claude subscription token: pick the Claude subscription as the provider")
	case provider == "claude-sub" && strings.HasPrefix(key, "sk-ant-api"):
		return httpx.New(http.StatusBadRequest, "key_is_api_key", "That's an Anthropic API key: pick Anthropic as the provider")
	}
	return nil
}

// checkKey asks the provider whether the key works, with a free request (the model list). Only a plain "this key is
// invalid" answer refuses it: a provider that is down, slow or answers anything else lets the key through, so its
// outage doesn't block saving. ChatGPT sign-ins aren't checked (no cheap endpoint takes them).
func (s *Service) checkKey(ctx context.Context, provider, key string) error {
	if !s.CheckKeys {
		return nil
	}
	var req *http.Request
	switch provider {
	case "anthropic", "claude-sub":
		req, _ = http.NewRequest(http.MethodGet, "https://api.anthropic.com/v1/models?limit=1", nil)
		req.Header.Set("anthropic-version", "2023-06-01")
		if provider == "claude-sub" {
			req.Header.Set("Authorization", "Bearer "+key)
			req.Header.Set("anthropic-beta", "oauth-2025-04-20")
		} else {
			req.Header.Set("x-api-key", key)
		}
	case "openai":
		req, _ = http.NewRequest(http.MethodGet, "https://api.openai.com/v1/models", nil)
		req.Header.Set("Authorization", "Bearer "+key)
	case "orcarouter":
		req, _ = http.NewRequest(http.MethodGet, orcaRouterModels, nil)
		req.Header.Set("Authorization", "Bearer "+key)
	case "google":
		req, _ = http.NewRequest(http.MethodGet, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", nil)
		req.Header.Set("x-goog-api-key", key)
	default:
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	resp, err := http.DefaultClient.Do(req.WithContext(ctx))
	if err != nil {
		slog.Warn("key check skipped", "provider", provider, "err", err)
		return nil
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
	// Google answers a bad key with 400 API_KEY_INVALID, the others with 401. A 403 can be a working key that may
	// not list models (an OpenAI restricted key), so it passes.
	// A subscription token is refused only when Anthropic calls it bad, not when the endpoint just won't take OAuth.
	msg := strings.ToLower(string(body))
	bad := resp.StatusCode == http.StatusUnauthorized
	if provider == "claude-sub" {
		bad = bad && (strings.Contains(msg, "invalid") || strings.Contains(msg, "expired") || strings.Contains(msg, "revoked"))
	}
	if bad || (provider == "google" && resp.StatusCode == http.StatusBadRequest && strings.Contains(string(body), "API_KEY_INVALID")) {
		return httpx.New(http.StatusBadRequest, "key_rejected", "The provider rejected this key")
	}
	return nil
}

const orcaRouterModels = "https://api.orcarouter.ai/v1/models"

// maskKey is how a saved key is shown back, like the providers' own consoles do: its public kind prefix
// ("sk-ant-api03-", "sk-proj-", "AIza") and its last four characters, e.g. "sk-ant-api03-…a1b2".
func maskKey(key string) string {
	prefix := ""
	if i := strings.LastIndex(key[:min(len(key)-8, 16)], "-"); i >= 0 {
		prefix = key[:i+1]
	} else if strings.HasPrefix(key, "AIza") {
		prefix = "AIza"
	}
	return prefix + "…" + key[len(key)-4:]
}
