// Package migrations sets up the database: the arena_app role the api and the gateway connect as, and the schema.
// There are no incremental migrations: schema.sql is the whole schema, applied once to an empty database.
package migrations

import (
	"context"
	_ "embed"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

//go:embed schema.sql
var schema string

// Apply connects as a role that owns the schema (never as arena_app), creates or updates the arena_app role with
// appPassword, and applies schema.sql when the database has no tables yet. A changed schema.sql needs a fresh
// database: Apply never alters existing tables.
func Apply(ctx context.Context, dsn, appPassword string) (created bool, err error) {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return false, fmt.Errorf("connect: %w", err)
	}
	defer conn.Close(ctx)
	// The password can't be a bind parameter in DDL; it is quoted as a literal instead and never written to a file.
	verb := "CREATE"
	var exists bool
	if err := conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_app')`).Scan(&exists); err != nil {
		return false, err
	}
	if exists {
		verb = "ALTER"
	}
	if _, err := conn.Exec(ctx, verb+` ROLE arena_app WITH LOGIN PASSWORD `+quoteLiteral(appPassword)+
		` NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`); err != nil {
		return false, fmt.Errorf("arena_app role: %w", err)
	}
	var table *string
	if err := conn.QueryRow(ctx, `SELECT to_regclass('runs')::text`).Scan(&table); err != nil {
		return false, err
	}
	if table != nil {
		return false, nil
	}
	return true, pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, schema)
		return err
	})
}

// quoteLiteral makes s a standard-conforming SQL string literal (Postgres defaults to
// standard_conforming_strings = on, so only single quotes need doubling).
func quoteLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}
