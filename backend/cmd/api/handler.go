package main

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/agents"
	"tolerance/internal/identity"
	"tolerance/internal/platform/clientip"
	"tolerance/internal/platform/db"
	"tolerance/internal/platform/httpx"
	"tolerance/internal/platform/idgen"
	"tolerance/internal/platform/ratelimit"
	"tolerance/internal/runs"
)

type deps struct {
	pool      *db.Pool
	log       *slog.Logger
	users     *identity.Service
	agents    *agents.Service
	runs      *runs.Service
	limiter   *ratelimit.Limiter
	providers map[string]identity.Provider
}

// newHandler is ALL the routing. Reads are public; uploading agents and starting runs is for admins only (for now
// only the platform owner, ownerEmail; the dev login doesn't change that).
func newHandler(cfg config, d deps) http.Handler {
	owner := http.NewServeMux()
	identity.RegisterMeRoute(owner, d.users, func(ctx context.Context, userID string) (map[string]any, error) {
		return map[string]any{"can_admin": identity.MustFromContext(ctx).Role == "admin"}, nil
	})

	admin := http.NewServeMux()
	agents.RegisterAdminRoutes(admin, d.agents)
	runs.RegisterAdminRoutes(admin, d.runs)

	public := http.NewServeMux()
	agents.RegisterPublicRoutes(public, d.agents)
	runs.RegisterPublicRoutes(public, d.runs)

	session := identity.RequireSession(d.users)
	api := http.NewServeMux()
	identity.RegisterAuthRoutes(api, d.users, d.limiter, identity.AuthConfig{
		Providers: d.providers, PublicURL: cfg.publicURL, DevLogin: cfg.devLogin, Secure: cfg.secureCookies, TrustProxy: cfg.trustProxy,
	})
	api.Handle("/api/v1/me", session(owner))
	api.Handle("/api/v1/admin/", session(identity.RequireAdmin(admin)))
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
	top.Handle("/api/", api)
	return withMiddleware(top, d.log, cfg.trustProxy)
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
