// Package migrations sets up the database: the arena_app role the api, the worker and the gateway connect as, and the
// schema, built by the numbered migrations NNNN_name.sql in name order. Each is applied once, in its own transaction,
// and recorded in schema_migrations with its hash. An applied migration is never edited: a change goes into the next
// one (a changed one stops Apply, so prod and a dev database can't silently differ).
package migrations

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

//go:embed *.sql
var files embed.FS

// baseline is the migration a database made before migrations began already has (it has tables but no
// schema_migrations): prod's schema at the time, so it is recorded as applied without running it.
const baseline = "0001_init.sql"

// lockID serializes migrators of one database (two deploys, or a deploy and a hand run).
const lockID = 7_301_000

type migration struct {
	name, sql, hash string
}

func all() ([]migration, error) {
	names, err := fs.Glob(files, "*.sql")
	if err != nil {
		return nil, err
	}
	sort.Strings(names)
	out := make([]migration, 0, len(names))
	for _, n := range names {
		b, err := files.ReadFile(n)
		if err != nil {
			return nil, err
		}
		h := sha256.Sum256(b)
		out = append(out, migration{name: n, sql: string(b), hash: hex.EncodeToString(h[:])})
	}
	return out, nil
}

// Apply connects as a role that owns the schema (never as arena_app), creates or updates the arena_app role with
// appPassword, and applies the migrations the database doesn't have yet. It returns their names.
func Apply(ctx context.Context, dsn, appPassword string) (applied []string, err error) {
	ms, err := all()
	if err != nil {
		return nil, err
	}
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	defer conn.Close(ctx)
	// The password can't be a bind parameter in DDL; it is quoted as a literal instead and never written to a file.
	verb := "CREATE"
	var exists bool
	if err := conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_app')`).Scan(&exists); err != nil {
		return nil, err
	}
	if exists {
		verb = "ALTER"
	}
	if _, err := conn.Exec(ctx, verb+` ROLE arena_app WITH LOGIN PASSWORD `+quoteLiteral(appPassword)+
		` NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`); err != nil {
		return nil, fmt.Errorf("arena_app role: %w", err)
	}

	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, lockID); err != nil {
		return nil, err
	}
	defer func() { _, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, lockID) }()

	var tracked, tables *string
	if err := conn.QueryRow(ctx, `SELECT to_regclass('schema_migrations')::text, to_regclass('runs')::text`).Scan(&tracked, &tables); err != nil {
		return nil, err
	}
	if tracked == nil {
		if _, err := conn.Exec(ctx, `CREATE TABLE schema_migrations (
				name       text PRIMARY KEY,
				sha256     text NOT NULL,
				applied_at timestamptz NOT NULL DEFAULT now()
			)`); err != nil {
			return nil, err
		}
		if tables != nil {
			for _, m := range ms {
				if m.name == baseline {
					if _, err := conn.Exec(ctx, `INSERT INTO schema_migrations (name, sha256) VALUES ($1, $2)`, m.name, m.hash); err != nil {
						return nil, err
					}
				}
			}
		}
	}

	done := map[string]string{}
	rows, err := conn.Query(ctx, `SELECT name, sha256 FROM schema_migrations`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var n, h string
		if err := rows.Scan(&n, &h); err != nil {
			rows.Close()
			return nil, err
		}
		done[n] = h
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for _, m := range ms {
		if h, ok := done[m.name]; ok {
			if h != m.hash {
				return applied, fmt.Errorf("%s changed after it was applied: put the change in a new migration", m.name)
			}
			continue
		}
		err := pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, m.sql); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `INSERT INTO schema_migrations (name, sha256) VALUES ($1, $2)`, m.name, m.hash)
			return err
		})
		if err != nil {
			return applied, fmt.Errorf("%s: %w", m.name, err)
		}
		applied = append(applied, m.name)
	}
	return applied, nil
}

// quoteLiteral makes s a standard-conforming SQL string literal (Postgres defaults to
// standard_conforming_strings = on, so only single quotes need doubling).
func quoteLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}
