// Command migrate sets up the database: the arena_app role and the migrations it doesn't have yet
// (backend/migrations). It connects with the role that owns the schema and never with arena_app.
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
	applied, err := migrations.Apply(context.Background(), dsn, password)
	for _, m := range applied {
		log.Printf("applied %s", m)
	}
	if err != nil {
		log.Fatalf("migrate: %v", err)
	}
	if len(applied) == 0 {
		log.Print("schema up to date")
	}
}
