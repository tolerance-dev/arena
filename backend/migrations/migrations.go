// Package migrations embeds the schema migrations and registers 00001, which creates the arena_app role with a
// password from the environment (never written into a SQL file). 00002 is the whole schema.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
