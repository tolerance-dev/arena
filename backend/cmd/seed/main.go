// Command seed fills a local database with real runs for free (make seed): a few agents built from the demo
// example, each run on every task through a gateway with ARENA_GATEWAY_FAKE=true, so no LLM key or token is spent.
// The runs go through the whole pipeline (agent, checks, screenshots), so scores, leaderboards and votes are real.
// It works on its own: an in-process worker carries the runs out (with `make dev` running, its worker helps).
// Running it again only fills in what is missing: an agent with a finished run on a task isn't run there again.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/agents"
	"tolerance/internal/identity"
	"tolerance/internal/platform/db"
	"tolerance/internal/platform/secretbox"
	"tolerance/internal/runs"
	"tolerance/internal/tasks"
)

// The fake gateway takes any key; this one only has to pass the format check.
const fakeKey = "sk-ant-seed-fake-key-not-real-000000"

// The seeded agents: the demo's reference app, and two that spoil it in their own way so the scores differ.
var seeds = []struct {
	owner, name, description string
	before, after            string // shell run before and after the demo's script
}{
	{owner: "ada@example.com", name: "Demo · эталон", description: "Эталонное приложение, проходит все проверки"},
	{owner: "ada@example.com", name: "Demo · без API",
		description: "Эталон без API: страницы есть, данных за ними нет",
		after:       `sed -i 's/^API = .*/API = None/' server.py`},
	{owner: "linus@example.com", name: "Demo · без кинотеатра",
		description: "Эталон, который сдаётся на кинотеатре",
		before:      `[ "$ARENA_TASK" = cinema ] && { echo "giving up on cinema"; exit 1; }`},
}

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelWarn}))
	slog.SetDefault(log)
	if err := run(log); err != nil {
		fmt.Fprintln(os.Stderr, "seed:", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	dsn := os.Getenv("ARENA_APP_DATABASE_URL")
	if u, err := url.Parse(dsn); err != nil || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost") {
		return errors.New("ARENA_APP_DATABASE_URL must point at a local database")
	}
	if os.Getenv("ARENA_GATEWAY_FAKE") != "true" {
		return errors.New("run it with the fake gateway (make seed): a real one would refuse the seed's fake key")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := tasks.Load(os.Getenv("ARENA_TASKS_HIDDEN_DIR")); err != nil {
		return fmt.Errorf("tasks: %w", err)
	}
	pool, err := db.Open(ctx, dsn)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer pool.Close()
	box, err := secretbox.New(os.Getenv("ARENA_SECRET_KEY"))
	if err != nil {
		return err
	}
	people := identity.NewService(pool, nil)
	agentSvc := agents.NewService(pool, box)
	runSvc := runs.NewService(pool, "", 0)
	demo, err := os.ReadFile("internal/agents/examples/demo/run.sh")
	if err != nil {
		return err
	}

	var queued []string
	for _, s := range seeds {
		u, _, err := people.DevSignIn(ctx, s.owner)
		if err != nil {
			return fmt.Errorf("user %s: %w", s.owner, err)
		}
		id, err := agentID(ctx, pool, u.ID, s.name)
		if err != nil {
			return err
		}
		if id == "" {
			a, err := agentSvc.Create(ctx, u.ID, false, agents.CreateInput{
				Name: s.name, Description: s.description, Provider: "anthropic", APIKey: fakeKey,
				Bundle: []byte(script(string(demo), s.before, s.after)),
			})
			if err != nil {
				return fmt.Errorf("agent %s: %w", s.name, err)
			}
			id = a.ID
		}
		for _, t := range tasks.All() {
			var have bool
			if err := pool.Raw().QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM runs WHERE agent_id = $1 AND task = $2
				AND status <> 'infra_error')`, id, t.Slug).Scan(&have); err != nil {
				return err
			}
			if have {
				continue
			}
			r, err := runSvc.Create(ctx, "", id, t.Slug, 0, 0)
			if err != nil {
				return fmt.Errorf("run %s on %s: %w", s.name, t.Slug, err)
			}
			queued = append(queued, r.ID)
		}
	}
	if len(queued) == 0 {
		fmt.Println("nothing to seed: every seeded agent has a run on every task")
		return nil
	}
	fmt.Printf("queued %d runs; each takes a minute or two\n", len(queued))

	// A worker of our own, so the seed doesn't need `make dev` running. It stops claiming once our runs are done.
	claim, endClaim := context.WithCancel(context.Background())
	defer endClaim()
	done := make(chan error, 1)
	host, _ := os.Hostname()
	go func() {
		done <- runs.NewWorker(pool, log, runs.WorkerConfig{Concurrency: 2, Drain: time.Hour}).Run(claim, ctx, host)
	}()
	err = wait(ctx, pool, queued)
	endClaim()
	if werr := <-done; err == nil {
		err = werr
	}
	return err
}

func agentID(ctx context.Context, pool *db.Pool, owner, name string) (string, error) {
	var id string
	err := pool.Raw().QueryRow(ctx, `SELECT id FROM agents WHERE owner_id = $1 AND name = $2`, owner, name).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// script wraps the demo's run.sh: before runs first, after once the demo has written the app.
func script(demo, before, after string) string {
	body := strings.TrimPrefix(demo, "#!/bin/sh\n")
	return "#!/bin/sh\nset -eu\n" + before + "\n(\n" + body + "\n)\ncd /work\n" + after + "\n"
}

// wait prints each run as it finishes and returns when all have.
func wait(ctx context.Context, pool *db.Pool, ids []string) error {
	seen := map[string]bool{}
	for len(seen) < len(ids) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(3 * time.Second):
		}
		rows, err := pool.Raw().Query(ctx, `SELECT r.id, a.name, r.task, r.status, r.score, coalesce(r.failure_reason, '')
			FROM runs r JOIN agents a ON a.id = r.agent_id WHERE r.id = ANY($1) AND r.status IN ('done', 'infra_error')`, ids)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id, name, task, status, reason string
			var score *int
			if err := rows.Scan(&id, &name, &task, &status, &score, &reason); err != nil {
				return err
			}
			if seen[id] {
				continue
			}
			seen[id] = true
			result := status + " " + reason
			if score != nil {
				result = fmt.Sprintf("score %d", *score)
			}
			fmt.Printf("  [%d/%d] %s, %s: %s\n", len(seen), len(ids), name, task, result)
		}
		if err := rows.Err(); err != nil {
			return err
		}
	}
	return nil
}
