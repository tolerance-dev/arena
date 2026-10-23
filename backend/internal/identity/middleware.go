package identity

import (
	"errors"
	"net/http"

	"tolerance/internal/platform/httpx"
)

// RequireSession authenticates the arena_session cookie and attaches a user Actor.
func RequireSession(s *Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c, err := r.Cookie(SessionCookie)
			if err != nil {
				httpx.WriteError(w, r, httpx.Unauthenticated("Sign in required"))
				return
			}
			u, err := s.UserBySession(r.Context(), c.Value)
			if errors.Is(err, ErrNoSession) {
				httpx.WriteError(w, r, httpx.Unauthenticated("Session expired, sign in again"))
				return
			}
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			if h := actorLogFromContext(r.Context()); h != nil {
				h.UserID = u.ID
			}
			next.ServeHTTP(w, r.WithContext(WithActor(r.Context(),
				Actor{UserID: u.ID, Role: u.Role})))
		})
	}
}

// RequireAdmin lets only admins through; it goes after RequireSession.
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a, ok := FromContext(r.Context()); !ok || a.Role != "admin" {
			httpx.WriteError(w, r, httpx.New(http.StatusForbidden, "forbidden", "Admins only"))
			return
		}
		next.ServeHTTP(w, r)
	})
}
