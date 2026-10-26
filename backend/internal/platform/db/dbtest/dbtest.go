// Package dbtest gives a test its own empty database with the schema applied, dropped when the test ends.
// ARENA_TEST_DATABASE_URL names a role that may create databases (make test-fast points it at the checkout's
// postgres, CI at a service container); without it the test is skipped.
package dbtest

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/platform/db"
	"tolerance/internal/platform/idgen"
	"tolerance/migrations"
)

func New(t *testing.T) *db.Pool {
	t.Helper()
	admin := os.Getenv("ARENA_TEST_DATABASE_URL")
	if admin == "" {
		t.Skip("ARENA_TEST_DATABASE_URL is not set (make test-fast sets it)")
	}
	ctx := context.Background()
	name := "arena_test_" + strings.TrimPrefix(idgen.New("x"), "x_")
	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)
	if _, err := conn.Exec(ctx, `CREATE DATABASE `+name); err != nil {
		t.Fatalf("create database: %v", err)
	}
	t.Cleanup(func() {
		c, err := pgx.Connect(context.Background(), admin)
		if err != nil {
			return
		}
		defer c.Close(context.Background())
		_, _ = c.Exec(context.Background(), `DROP DATABASE IF EXISTS `+name+` WITH (FORCE)`)
	})
	u, err := url.Parse(admin)
	if err != nil {
		t.Fatalf("parse ARENA_TEST_DATABASE_URL: %v", err)
	}
	u.Path = "/" + name
	dsn := u.String()
	if _, err := migrations.Apply(ctx, dsn, "test"); err != nil {
		t.Fatalf("apply schema: %v", err)
	}
	pool, err := db.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}
