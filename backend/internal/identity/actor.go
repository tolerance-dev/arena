package identity

import (
	"context"
	"os"
	"strings"
)

// Actor is the signed-in user making the request.
type Actor struct {
	UserID string
	Role   string // "user" | "admin"
}

type actorKey struct{}

func WithActor(ctx context.Context, a Actor) context.Context {
	return context.WithValue(ctx, actorKey{}, a)
}

// FromContext returns the actor attached by a Require* middleware.
func FromContext(ctx context.Context) (Actor, bool) {
	a, ok := ctx.Value(actorKey{}).(Actor)
	return a, ok
}

// MustFromContext panics if no actor is attached. Every HTTP handler behind
// a Require* middleware can rely on this never panicking in production; a
// panic here means a route was wired outside the middleware chain, which is
// a startup wiring bug, not a request-time condition to recover from.
func MustFromContext(ctx context.Context) Actor {
	a, ok := FromContext(ctx)
	if !ok {
		panic("identity: handler reached without an authenticating middleware")
	}
	return a
}

// ActorLog is a small mutable holder an outer HTTP middleware (the request
// logger) places into the context before calling into the auth middleware
// chain. RequireSession fills in the id they resolve as the
// request passes through. This exists because r.WithContext returns a new
// *http.Request; the outer middleware's own r value never sees a context
// value attached deeper in the chain, so FromContext there would always
// miss. A pointer stored in the context is the one thing both sides share:
// mutating *ActorLog through it is visible to whoever holds the pointer,
// context copies notwithstanding.
type ActorLog struct {
	UserID string
}

type actorLogKey struct{}

// WithActorLog attaches h for a downstream Require* middleware to fill in.
func WithActorLog(ctx context.Context, h *ActorLog) context.Context {
	return context.WithValue(ctx, actorLogKey{}, h)
}

// actorLogFromContext returns the holder placed by WithActorLog, or nil on
// a route with no request logger wired in front.
func actorLogFromContext(ctx context.Context) *ActorLog {
	h, _ := ctx.Value(actorLogKey{}).(*ActorLog)
	return h
}

// OwnerScope is the owner filter for the signed-in user's own things (agents, runs): their user id, or "" for an
// admin, who may manage everyone's.
func OwnerScope(ctx context.Context) string {
	a := MustFromContext(ctx)
	if a.Role == "admin" {
		return ""
	}
	return a.UserID
}

// OwnerEmail is the site owner (ARENA_OWNER_EMAIL): always an admin, the only one who may key agents with a personal
// subscription, and whose ready agents play the weekly tournament (internal/runs/tournament.go). "" = no owner, as in
// a fork that hasn't set it: the address isn't in the code, so nobody else's becomes an admin there.
var OwnerEmail = strings.TrimSpace(os.Getenv("ARENA_OWNER_EMAIL"))

// IsOwner says email is the owner's; never when there is no owner (an account without an email isn't the owner).
func IsOwner(email string) bool { return OwnerEmail != "" && strings.EqualFold(email, OwnerEmail) }
