package runs

import (
	"context"
	"testing"

	"tolerance/internal/identity"
	"tolerance/internal/platform/idgen"
)

// An agent keyed with a personal subscription runs only for its owner: another admin, who may run anyone's agent,
// must not spend it, and neither may a call without a signed-in actor.
func TestSubscriptionRunsOnlyForItsOwner(t *testing.T) {
	f := newQuotaFixture(t)
	f.sql(`UPDATE agents SET provider = 'claude-sub' WHERE id = $1`, f.agent)
	other := idgen.New("usr")
	f.sql(`INSERT INTO users (id, email, handle) VALUES ($1, $1 || '@example.com', $1)`, other)
	as := func(user, role string) context.Context {
		return identity.WithActor(context.Background(), identity.Actor{UserID: user, Role: role})
	}

	if _, err := f.s.Create(as(other, "admin"), "", f.agent, "marketplace", 0, 0); err == nil {
		t.Fatal("another admin ran the owner's subscription agent")
	}
	if _, err := f.s.Create(context.Background(), "", f.agent, "marketplace", 0, 0); err == nil {
		t.Fatal("a call with no actor ran a subscription agent")
	}
	if _, err := f.s.Create(as(f.user, "admin"), "", f.agent, "marketplace", 0, 0); err != nil {
		t.Fatalf("the owner (admin scope): %v", err)
	}
	if _, err := f.s.Create(as(f.user, "user"), f.user, f.agent, "marketplace", 0, 0); err != nil {
		t.Fatalf("the owner (own scope): %v", err)
	}
	if n := f.count(`SELECT count(*) FROM runs WHERE agent_id = $1`, f.agent); n != 2 {
		t.Fatalf("runs = %d, want 2", n)
	}
}
