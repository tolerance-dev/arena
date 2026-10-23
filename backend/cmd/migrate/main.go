// Command migrate sets up the database: the arena_app role and, on an empty database, the schema. It connects with
// the role that owns the schema and never with arena_app.
package main

import (
	"context"
	"log"
	"os"

	"tolerance/migrations"
)

func main() {
	dsn := os.Getenv("ARENA_MIGRATE_DATABASE_URL")
	if dsn == "" {
		log.Fatal("ARENA_MIGRATE_DATABASE_URL must be set to a role that owns the schema")
	}
	password := os.Getenv("ARENA_APP_ROLE_PASSWORD")
	if password == "" {
		log.Fatal("ARENA_APP_ROLE_PASSWORD must be set: it is the arena_app role's password")
	}
	created, err := migrations.Apply(context.Background(), dsn, password)
	if err != nil {
		log.Fatalf("migrate: %v", err)
	}
	if created {
		log.Print("schema created")
	} else {
		log.Print("schema already there; a changed schema.sql needs a fresh database (make reset, reset_db=true)")
	}
}
