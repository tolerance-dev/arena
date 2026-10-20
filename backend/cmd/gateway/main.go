// Command gateway is the sandboxes' only way out (LLM APIs, package registries) and serves live previews of
// finished runs. It runs in a container on both the default network and the internal arena-agents network.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tolerance/internal/gateway"
	"tolerance/internal/platform/db"
	"tolerance/internal/platform/secretbox"
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dsn := os.Getenv("ARENA_APP_DATABASE_URL")
	if dsn == "" {
		log.Error("ARENA_APP_DATABASE_URL is required")
		os.Exit(1)
	}
	box, err := secretbox.New(os.Getenv("ARENA_SECRET_KEY"))
	if err != nil {
		log.Error("secret key", "err", err)
		os.Exit(1)
	}
	pool, err := db.Open(ctx, dsn)
	if err != nil {
		log.Error("open database", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	cfg := gateway.Config{
		JudgeKey:     os.Getenv("ARENA_JUDGE_API_KEY"),
		FakeUpstream: os.Getenv("ARENA_GATEWAY_FAKE") == "true",
		SelfURL:      env("ARENA_GATEWAY_SELF_URL", "http://gateway:8090"),
	}
	gw := gateway.New(pool, box, cfg, log)
	previews := gateway.NewPreviews(pool, env("ARENA_PREVIEW_DOMAIN", "preview.localhost"), os.Getenv("ARENA_PREVIEW_PREFIX"),
		os.Getenv("ARENA_PUBLIC_URL"), log)
	go previews.Run(ctx)

	servers := []*http.Server{
		{Addr: env("ARENA_GATEWAY_ADDR", "0.0.0.0:8090"), Handler: gw.Handler(), ReadHeaderTimeout: 10 * time.Second},
		{Addr: env("ARENA_PREVIEW_ADDR", "0.0.0.0:8091"), Handler: previews, ReadHeaderTimeout: 10 * time.Second},
	}
	errs := make(chan error, len(servers))
	for _, s := range servers {
		go func() {
			log.Info("gateway listening", "addr", s.Addr)
			if err := s.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				errs <- err
			}
		}()
	}
	log.Info("gateway up", "judge", cfg.JudgeKey != "", "fake_upstream", cfg.FakeUpstream)
	select {
	case <-ctx.Done():
	case err := <-errs:
		log.Error("serve", "err", err)
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, s := range servers {
		_ = s.Shutdown(shutdown)
	}
}
