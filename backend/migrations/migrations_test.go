package migrations

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

// freshDB makes an empty database for the test and returns its address (skipped without ARENA_TEST_DATABASE_URL).
// Not dbtest.New: that one applies the migrations itself.
func freshDB(t *testing.T, name string) string {
	t.Helper()
	admin := os.Getenv("ARENA_TEST_DATABASE_URL")
	if admin == "" {
		t.Skip("ARENA_TEST_DATABASE_URL is not set (make test-fast sets it)")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	if _, err := conn.Exec(ctx, `DROP DATABASE IF EXISTS `+name+` WITH (FORCE)`); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, `CREATE DATABASE `+name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		c, err := pgx.Connect(context.Background(), admin)
		if err == nil {
			_, _ = c.Exec(context.Background(), `DROP DATABASE IF EXISTS `+name+` WITH (FORCE)`)
			c.Close(context.Background())
		}
	})
	u, _ := url.Parse(admin)
	u.Path = "/" + name
	return u.String()
}

func exec(t *testing.T, dsn, q string) {
	t.Helper()
	conn, err := pgx.Connect(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(context.Background())
	if _, err := conn.Exec(context.Background(), q); err != nil {
		t.Fatal(err)
	}
}

func names(t *testing.T) []string {
	ms, err := all()
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, m := range ms {
		out = append(out, m.name)
	}
	return out
}

// An empty database gets every migration; a second run applies nothing.
func TestApplyFresh(t *testing.T) {
	dsn := freshDB(t, "arena_test_migrate_fresh")
	got, err := Apply(context.Background(), dsn, "test")
	if err != nil {
		t.Fatal(err)
	}
	if want := names(t); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("applied %v, want %v", got, want)
	}
	if got, err := Apply(context.Background(), dsn, "test"); err != nil || len(got) != 0 {
		t.Fatalf("second run: %v %v", got, err)
	}
}

// A database made before migrations began (prod: the init schema, no schema_migrations) keeps its data and gets
// only the later migrations.
func TestApplyBaseline(t *testing.T) {
	dsn := freshDB(t, "arena_test_migrate_baseline")
	init, err := files.ReadFile(baseline)
	if err != nil {
		t.Fatal(err)
	}
	exec(t, dsn, `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_app') THEN CREATE ROLE arena_app; END IF; END $$`)
	exec(t, dsn, string(init))
	exec(t, dsn, `INSERT INTO users (id, email, handle) VALUES ('u_1', 'a@example.com', 'a')`)

	got, err := Apply(context.Background(), dsn, "test")
	if err != nil {
		t.Fatal(err)
	}
	if want := names(t)[1:]; strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("applied %v, want %v", got, want)
	}
	conn, err := pgx.Connect(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(context.Background())
	var users int
	if err := conn.QueryRow(context.Background(), `SELECT count(*) FROM users`).Scan(&users); err != nil || users != 1 {
		t.Fatalf("users kept: %d %v", users, err)
	}
}

// An applied migration that was edited afterwards stops Apply.
func TestApplyChanged(t *testing.T) {
	dsn := freshDB(t, "arena_test_migrate_changed")
	if _, err := Apply(context.Background(), dsn, "test"); err != nil {
		t.Fatal(err)
	}
	exec(t, dsn, `UPDATE schema_migrations SET sha256 = 'old' WHERE name = '`+baseline+`'`)
	if _, err := Apply(context.Background(), dsn, "test"); err == nil || !strings.Contains(err.Error(), "changed after it was applied") {
		t.Fatalf("edited migration: %v", err)
	}
}
