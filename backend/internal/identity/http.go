package identity

import (
	"context"
	"crypto/subtle"
	"errors"
	"log/slog"
	"maps"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"golang.org/x/oauth2"

	"tolerance/internal/platform/clientip"
	"tolerance/internal/platform/httpx"
	"tolerance/internal/platform/ratelimit"
)

// clientIP resolves the address to rate-limit on. See clientip.FromRequest
// for what trustProxy means; behind Caddy every request otherwise arrives
// from Caddy's own address, so without it the whole site would share one
// rate-limit bucket.
func clientIP(r *http.Request, trustProxy bool) string {
	return clientip.FromRequest(r, trustProxy)
}

// AuthConfig is what the auth routes need from the server config.
type AuthConfig struct {
	Providers map[string]Provider // "github", "google": only the configured ones
	PublicURL string              // base of redirect_uri, e.g. https://tolerance.cc
	// OAuthRelay, when set (local stacks: http://localhost:2999), replaces PublicURL in redirect_uri, so the
	// providers need one registered callback for every checkout's port. The relay (dev/oauth-relay.conf) sends
	// the browser on to the port that prefixes state ("3100-<random>").
	OAuthRelay string
	Secure     bool // Secure flag on cookies
	// TrustProxy must only be true when a reverse proxy in front sets
	// X-Real-IP itself (never trust it otherwise) — see clientip.FromRequest.
	TrustProxy bool
}

// OAuthCookie carries the state and PKCE verifier between start and callback.
const OAuthCookie = "arena_oauth"

// RegisterAuthRoutes mounts the unauthenticated auth routes: the provider
// list, logout and OAuth start/callback.
func RegisterAuthRoutes(mux *http.ServeMux, s *Service, limiter *ratelimit.Limiter, cfg AuthConfig) {
	mux.HandleFunc("GET /api/v1/auth/providers", func(w http.ResponseWriter, r *http.Request) {
		names := slices.Sorted(maps.Keys(cfg.Providers))
		if names == nil {
			names = []string{}
		}
		httpx.Respond(w, http.StatusOK, map[string]any{"providers": names})
	})
	mux.HandleFunc("GET /api/v1/auth/{provider}/start", oauthStart(limiter, cfg))
	mux.HandleFunc("GET /api/v1/auth/{provider}/callback", oauthCallback(s, limiter, cfg))
	mux.HandleFunc("POST /api/v1/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie(SessionCookie); err == nil {
			if err := s.Logout(r.Context(), c.Value); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
		}
		ClearSessionCookie(w, cfg.Secure)
		w.WriteHeader(http.StatusNoContent)
	})
}

func (c AuthConfig) redirectURL(provider string) string {
	base := c.PublicURL
	if c.OAuthRelay != "" {
		base = c.OAuthRelay
	}
	return strings.TrimRight(base, "/") + "/api/v1/auth/" + provider + "/callback"
}

func setOAuthCookie(w http.ResponseWriter, value string, maxAge int, secure bool) {
	http.SetCookie(w, &http.Cookie{Name: OAuthCookie, Value: value, Path: "/api/v1/auth/", HttpOnly: true,
		Secure: secure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}

// oauthStart sends the browser to the provider. state and the PKCE verifier
// stay in a ten-minute cookie; the callback checks them.
func oauthStart(limiter *ratelimit.Limiter, cfg AuthConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("provider")
		p, ok := cfg.Providers[name]
		if !ok {
			httpx.WriteError(w, r, httpx.NotFound())
			return
		}
		if !limiter.Allow("oauth:ip:"+clientIP(r, cfg.TrustProxy), 20, time.Minute) {
			http.Redirect(w, r, "/login?error=rate_limited", http.StatusFound)
			return
		}
		state, _, err := newSessionToken() // 32 random bytes, hex
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if cfg.OAuthRelay != "" {
			if u, err := url.Parse(cfg.PublicURL); err == nil {
				state = u.Port() + "-" + state
			}
		}
		st := oauthState{Provider: name, State: state, Verifier: oauth2.GenerateVerifier(), Next: safeNext(r.URL.Query().Get("next"))}
		setOAuthCookie(w, encodeState(st), 600, cfg.Secure)
		http.Redirect(w, r, p.AuthCodeURL(st.State, st.Verifier, cfg.redirectURL(name)), http.StatusFound)
	}
}

// oauthCallback finishes the sign-in. It is a browser navigation, so every
// failure is a redirect to /login with a code the page explains.
func oauthCallback(s *Service, limiter *ratelimit.Limiter, cfg AuthConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("provider")
		p, ok := cfg.Providers[name]
		if !ok {
			httpx.WriteError(w, r, httpx.NotFound())
			return
		}
		setOAuthCookie(w, "", -1, cfg.Secure) // single use, whatever happens next
		fail := func(code string) {
			http.Redirect(w, r, "/login?error="+code, http.StatusFound)
		}
		if !limiter.Allow("oauth:ip:"+clientIP(r, cfg.TrustProxy), 20, time.Minute) {
			fail("rate_limited")
			return
		}
		q := r.URL.Query()
		if q.Get("error") != "" {
			fail("oauth_denied")
			return
		}
		c, err := r.Cookie(OAuthCookie)
		if err != nil {
			fail("oauth_state")
			return
		}
		st, err := decodeState(c.Value)
		if err != nil || st.Provider != name || subtle.ConstantTimeCompare([]byte(st.State), []byte(q.Get("state"))) != 1 {
			fail("oauth_state")
			return
		}
		id, err := p.Identify(r.Context(), q.Get("code"), st.Verifier, cfg.redirectURL(name))
		if err != nil {
			slog.WarnContext(r.Context(), "oauth identify failed", "provider", name, "err", err)
			fail("oauth_failed")
			return
		}
		id.Provider = name
		_, token, err := s.SignIn(r.Context(), id)
		if errors.Is(err, ErrEmailUnverified) {
			fail("email_unverified")
			return
		}
		if err != nil {
			slog.ErrorContext(r.Context(), "oauth sign-in failed", "provider", name, "err", err)
			fail("oauth_failed")
			return
		}
		SetSessionCookie(w, token, cfg.Secure)
		// st.Next was already validated by safeNext when the cookie was set,
		// but the cookie is not signed, so re-check before trusting it here.
		http.Redirect(w, r, safeNext(st.Next), http.StatusFound)
	}
}

// RegisterMeRoute mounts GET /me. extras adds sibling keys to the response (e.g. can_admin) from
// packages identity does not import.
func RegisterMeRoute(mux *http.ServeMux, s *Service, extras func(ctx context.Context, userID string) (map[string]any, error)) {
	mux.HandleFunc("GET /api/v1/me", func(w http.ResponseWriter, r *http.Request) {
		actor := MustFromContext(r.Context())
		u, err := s.Get(r.Context(), actor.UserID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out := map[string]any{"user": u}
		if extras != nil {
			more, err := extras(r.Context(), actor.UserID)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			for k, v := range more {
				out[k] = v
			}
		}
		httpx.Respond(w, http.StatusOK, out)
	})
}
