package main

import (
	"context"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/admin"
	"tolerance/internal/agents"
	"tolerance/internal/identity"
	"tolerance/internal/platform/clientip"
	"tolerance/internal/platform/db"
	"tolerance/internal/platform/httpx"
	"tolerance/internal/platform/idgen"
	"tolerance/internal/platform/ratelimit"
	"tolerance/internal/runs"
	"tolerance/internal/sandbox"
)

type deps struct {
	pool      *db.Pool
	log       *slog.Logger
	users     *identity.Service
	admin     *admin.Service
	agents    *agents.Service
	runs      *runs.Service
	limiter   *ratelimit.Limiter
	providers map[string]identity.Provider
}

// newHandler is ALL the routing. Reads are public; any signed-in user uploads agents and starts runs on their own
// agents (/api/v1/my/*); admins (ownerEmail + ARENA_ADMIN_EMAILS) may manage everyone's and skip the per-user limits.
func newHandler(cfg config, d deps) http.Handler {
	owner := http.NewServeMux()
	identity.RegisterMeRoute(owner, d.users, func(ctx context.Context, userID string) (map[string]any, error) {
		admin := identity.MustFromContext(ctx).Role == "admin"
		return map[string]any{"can_admin": admin, "subscriptions": admin && cfg.subscriptions}, nil
	})

	owner.HandleFunc("DELETE /api/v1/me", func(w http.ResponseWriter, r *http.Request) {
		ids, err := d.users.DeleteAccount(r.Context(), identity.MustFromContext(r.Context()).UserID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		for _, id := range ids {
			go sandbox.RemoveImage(runs.ImageFor(id))
		}
		identity.ClearSessionCookie(w, cfg.secureCookies)
		w.WriteHeader(http.StatusNoContent)
	})

	mine := http.NewServeMux()
	agents.RegisterOwnerRoutes(mine, d.agents)
	runs.RegisterOwnerRoutes(mine, d.runs)

	adminMux := http.NewServeMux()
	admin.RegisterRoutes(adminMux, d.admin)

	public := http.NewServeMux()
	agents.RegisterPublicRoutes(public, d.agents)
	runs.RegisterPublicRoutes(public, d.runs)

	session := identity.RequireSession(d.users)
	api := http.NewServeMux()
	identity.RegisterAuthRoutes(api, d.users, d.limiter, identity.AuthConfig{
		Providers: d.providers, PublicURL: cfg.publicURL, OAuthRelay: cfg.oauthRelay, Secure: cfg.secureCookies, TrustProxy: cfg.trustProxy,
	})
	api.Handle("/api/v1/me", session(owner))
	api.Handle("/api/v1/my/", session(mine))
	api.Handle("/api/v1/admin/", session(identity.RequireAdmin(adminMux)))
	api.Handle("/api/v1/tasks", public)
	api.Handle("/api/v1/tasks/", public)
	api.Handle("/api/v1/runs", public)
	api.Handle("/api/v1/runs/", public)
	api.Handle("/api/v1/agents", public)
	api.Handle("/api/v1/agents/", public)

	top := http.NewServeMux()
	top.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := d.pool.Tx(r.Context(), func(ctx context.Context, tx pgx.Tx) error {
			_, err := tx.Exec(ctx, "SELECT 1")
			return err
		}); err != nil {
			httpx.Respond(w, http.StatusServiceUnavailable, map[string]string{"status": "db_unavailable"})
			return
		}
		httpx.Respond(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	top.Handle("/api/", sameOrigin(cfg.publicURL, api))
	return withMiddleware(top, d.log, cfg.trustProxy)
}

// sameOrigin refuses state-changing API requests that a browser sent from another origin. Live previews run
// agent-written pages on p-<run>.<domain>, which browsers count as the same site, so SameSite=Lax cookies alone
// would let such a page act as the admin viewing it. Requests without these headers (curl, server to server) pass:
// only a browser carries someone else's cookies.
func sameOrigin(publicURL string, next http.Handler) http.Handler {
	want := ""
	if u, err := url.Parse(publicURL); err == nil && u.Scheme != "" && u.Host != "" {
		want = u.Scheme + "://" + u.Host
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
		default:
			site, origin := r.Header.Get("Sec-Fetch-Site"), r.Header.Get("Origin")
			if (site != "" && site != "same-origin" && site != "none") || (origin != "" && want != "" && origin != want) {
				httpx.WriteError(w, r, httpx.New(http.StatusForbidden, "cross_origin", "This request must come from the site itself"))
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) { s.status = code; s.ResponseWriter.WriteHeader(code) }

// withMiddleware adds request-id, security headers and one structured log
// line per request. The line never includes query strings, headers,
// cookies, Authorization, or any request/response body content (uploads
// included) — only routing and identity metadata. user_id
// is read from a holder that RequireSession fills in as the
// request is authenticated further down the chain (see identity.ActorLog):
// this handler's own r is a different *http.Request value than the one
// those middlewares attach the actor to, so FromContext here would always
// miss; the holder is the one thing both sides share.
func withMiddleware(next http.Handler, log *slog.Logger, trustProxy bool) http.Handler {
	withRequestID := httpx.WithRequestID(func() string { return idgen.New("req") })(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		sw := &statusWriter{ResponseWriter: w, status: 200}
		actorLog := &identity.ActorLog{}
		r = r.WithContext(identity.WithActorLog(r.Context(), actorLog))
		start := time.Now()
		withRequestID.ServeHTTP(sw, r)
		ms := time.Since(start).Milliseconds()
		route := r.Method + " " + r.URL.Path
		fields := []any{
			"request_id", sw.Header().Get("X-Request-Id"),
			"route", route,
			"status", sw.status,
			"ms", ms,
			"client_ip", clientip.FromRequest(r, trustProxy),
		}
		if actorLog.UserID != "" {
			fields = append(fields, "user_id", actorLog.UserID)
		}
		if sw.status >= 500 {
			log.Error("request failed", fields...)
			return
		}
		log.Info("request", fields...)
	})
}
