// Command gateway is the sandboxes' only way out (LLM APIs, package registries) and serves live previews of
// finished runs. It runs in a container labelled arena.gateway=<stack>; the runs worker attaches it to each run's
// internal network (sandbox.CreateNetwork), and the previews it attaches itself.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tolerance/internal/gateway"
	"tolerance/internal/platform/db"
	"tolerance/internal/platform/secretbox"
	"tolerance/internal/sandbox"
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
		JudgeKey:      os.Getenv("ARENA_JUDGE_API_KEY"),
		JudgeURL:      os.Getenv("ARENA_JUDGE_BASE_URL"),
		Subscriptions: os.Getenv("ARENA_SUBSCRIPTIONS") == "true",
		FakeUpstream:  os.Getenv("ARENA_GATEWAY_FAKE") == "true",
		SelfURL:       env("ARENA_GATEWAY_SELF_URL", "http://gateway:8090"),
	}
	gw := gateway.New(pool, box, cfg, log)
	previews := gateway.NewPreviews(pool, env("ARENA_PREVIEW_DOMAIN", "preview.localhost"), os.Getenv("ARENA_PREVIEW_PREFIX"),
		os.Getenv("ARENA_PUBLIC_URL"), log)
	go previews.Run(ctx)

	servers := []*http.Server{
		{Addr: env("ARENA_GATEWAY_ADDR", "0.0.0.0:8090"), Handler: gw.Handler(), ReadHeaderTimeout: 10 * time.Second},
	}
	// Previews only on the addresses the site's proxy uses, never on the run networks: an agent must not open other
	// runs' apps through the gateway.
	previewAddrs := []string{os.Getenv("ARENA_PREVIEW_ADDR")}
	if previewAddrs[0] == "" {
		self, _ := os.Hostname() // the container id
		ips, err := sandbox.PublicIPs(ctx, self)
		if err != nil {
			log.Error("preview addresses (set ARENA_PREVIEW_ADDR outside Docker)", "err", err)
			os.Exit(1)
		}
		previewAddrs = previewAddrs[:0]
		for _, ip := range ips {
			previewAddrs = append(previewAddrs, net.JoinHostPort(ip, "8091"))
		}
	}
	for _, addr := range previewAddrs {
		servers = append(servers, &http.Server{Addr: addr, Handler: previews, ReadHeaderTimeout: 10 * time.Second})
	}
	// A new gateway container isn't on the networks of the runs in flight yet.
	sandbox.AttachGateway(ctx)
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
