// Command api is the tolerance backend: the HTTP API plus the runs worker (agents build apps in sandboxes, the
// platform checks them), one process. The gateway (cmd/gateway) is a separate container.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"tolerance/internal/admin"
	"tolerance/internal/agents"
	"tolerance/internal/identity"
	"tolerance/internal/platform/clientip"
	"tolerance/internal/platform/db"
	"tolerance/internal/platform/ratelimit"
	"tolerance/internal/platform/secretbox"
	"tolerance/internal/runs"
	"tolerance/internal/tasks"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(log)
	cfg, err := loadConfig()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}
	if cfg.secureCookies {
		identity.UseHostPrefix()
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := tasks.Load(cfg.tasksHiddenDir); err != nil {
		log.Error("tasks", "err", err)
		os.Exit(1)
	}
	box, err := secretbox.New(cfg.secretKey)
	if err != nil {
		log.Error("secret key", "err", err)
		os.Exit(1)
	}
	pool, err := db.Open(ctx, cfg.databaseURL)
	if err != nil {
		log.Error("open database", "err", err)
		os.Exit(1)
	}
	defer pool.Close()
	if err := checkSchema(ctx, pool); err != nil {
		log.Error("schema check", "err", err)
		os.Exit(1)
	}

	d := deps{
		pool: pool, log: log, users: identity.NewService(pool, cfg.adminEmails), admin: admin.NewService(pool),
		agents: agentService(pool, box, cfg.subscriptions), runs: runs.NewService(pool, cfg.previewURL, cfg.runConcurrency),
		limiter: ratelimit.New(nil), providers: providersFromConfig(cfg),
	}
	// Votes: a person comparing apps does a few a minute; more than this from one account or address is stuffing.
	d.runs.VoteAllowed = func(r *http.Request, userID string) bool {
		return d.limiter.Allow("vote:user:"+userID, 60, time.Hour) &&
			d.limiter.Allow("vote:ip:"+clientip.FromRequest(r, cfg.trustProxy), 120, time.Hour)
	}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		runs.NewWorker(pool, log, runs.WorkerConfig{Concurrency: cfg.runConcurrency}).Run(ctx)
	}()

	server := &http.Server{
		Addr:              cfg.addr,
		Handler:           newHandler(cfg, d),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       120 * time.Second, // agent bundles are up to 20 MB
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    64 << 10,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Error("shutdown", "err", err)
		}
	}()
	log.Info("api listening", "addr", cfg.addr, "tasks", len(tasks.All()))
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("serve", "err", err)
		os.Exit(1)
	}
	wg.Wait()
}

// checkSchema fails fast when the database has not been migrated to the agent runs schema.
func checkSchema(ctx context.Context, pool *db.Pool) error {
	var name *string
	if err := pool.Raw().QueryRow(ctx, `SELECT to_regclass('runs')`).Scan(&name); err != nil {
		return fmt.Errorf("check schema: %w", err)
	}
	if name == nil {
		return errors.New("database schema is out of date: the runs table is missing; run make migrate")
	}
	return nil
}

func agentService(pool *db.Pool, box *secretbox.Box, subscriptions bool) *agents.Service {
	s := agents.NewService(pool, box)
	s.Subscriptions = subscriptions
	return s
}
