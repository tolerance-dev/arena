// Command worker carries out runs: it claims queued runs, runs the agent and then the checks in sandboxes (through
// the host's docker), and writes the verdict. It is its own process, apart from the api, so an api deploy leaves the
// runs in flight alone. Several may run at once: each owns the runs it claimed (internal/runs/worker.go).
//
// SIGTERM (or Ctrl-C) stops claiming and drains: the runs in flight go on for up to ARENA_WORKER_DRAIN; a second
// signal stops them at once. Either way a run given up becomes infra_error.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"tolerance/internal/platform/db"
	"tolerance/internal/runs"
	"tolerance/internal/tasks"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(log)
	if err := run(log); err != nil {
		log.Error("worker", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	dsn := os.Getenv("ARENA_APP_DATABASE_URL")
	if dsn == "" {
		return errors.New("ARENA_APP_DATABASE_URL is required")
	}
	cfg := runs.WorkerConfig{Concurrency: 1, Drain: time.Hour} // a run is at most ~30 min of agent + 25 of checks
	if v := os.Getenv("ARENA_RUN_CONCURRENCY"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			return errors.New("ARENA_RUN_CONCURRENCY must be an integer >= 1")
		}
		cfg.Concurrency = n
	}
	if v := os.Getenv("ARENA_WORKER_DRAIN"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d < 0 {
			return errors.New("ARENA_WORKER_DRAIN must be a duration, e.g. 60m")
		}
		cfg.Drain = d
	}

	// The first signal stops claiming (drain), the second gives the runs in flight up.
	stop, endStop := context.WithCancel(context.Background())
	abort, endAbort := context.WithCancel(context.Background())
	defer endStop()
	defer endAbort()
	sig := make(chan os.Signal, 2)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sig
		log.Info("signal: draining; send another to stop the runs in flight now")
		endStop()
		<-sig
		endAbort()
	}()

	if err := tasks.Load(os.Getenv("ARENA_TASKS_HIDDEN_DIR")); err != nil {
		return fmt.Errorf("tasks: %w", err)
	}
	pool, err := db.Open(stop, dsn)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer pool.Close()
	var name *string
	if err := pool.Raw().QueryRow(stop, `SELECT to_regclass('workers')`).Scan(&name); err != nil {
		return fmt.Errorf("check schema: %w", err)
	}
	if name == nil {
		return errors.New("database schema is out of date: the workers table is missing; recreate the database (make reset)")
	}
	host, _ := os.Hostname()
	return runs.NewWorker(pool, log, cfg).Run(stop, abort, host)
}
