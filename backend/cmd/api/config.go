package main

import (
	"errors"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"

	"tolerance/internal/identity"
)

// ownerEmail is always an admin (uploads agents, starts runs), on every deployment; ARENA_ADMIN_EMAILS adds more.
const ownerEmail = "alimov.nsm@gmail.com"

type config struct {
	addr             string
	databaseURL      string
	adminEmails      []string
	secureCookies    bool
	trustProxy       bool // ARENA_TRUST_PROXY: take the client IP from X-Real-IP
	allowNonLoopback bool
	secretKey        string // ARENA_SECRET_KEY: seals agents' LLM keys (the gateway opens them)
	publicURL        string
	previewURL       string // ARENA_PREVIEW_URL: live preview address with {id}, e.g. http://{id}.preview.localhost:3023
	runConcurrency   int
	githubID         string
	githubSecret     string
	googleID         string
	googleSecret     string
	tasksHiddenDir   string // ARENA_TASKS_HIDDEN_DIR: <slug>/checks.json overrides (the private arena-tasks repo)
	subscriptions    bool   // ARENA_SUBSCRIPTIONS: admins may run agents on their own Claude/ChatGPT subscription (local only)
}

func loadConfig() (config, error) {
	cfg := config{
		addr:             env("ARENA_ADDR", "127.0.0.1:8080"),
		databaseURL:      os.Getenv("ARENA_APP_DATABASE_URL"),
		secureCookies:    os.Getenv("ARENA_SECURE_COOKIES") == "true",
		trustProxy:       os.Getenv("ARENA_TRUST_PROXY") == "true",
		allowNonLoopback: os.Getenv("ARENA_ALLOW_NON_LOOPBACK") == "true",
		secretKey:        os.Getenv("ARENA_SECRET_KEY"),
		publicURL:        os.Getenv("ARENA_PUBLIC_URL"),
		previewURL:       os.Getenv("ARENA_PREVIEW_URL"),
		runConcurrency:   1,
		githubID:         os.Getenv("ARENA_GITHUB_CLIENT_ID"),
		githubSecret:     os.Getenv("ARENA_GITHUB_CLIENT_SECRET"),
		googleID:         os.Getenv("ARENA_GOOGLE_CLIENT_ID"),
		googleSecret:     os.Getenv("ARENA_GOOGLE_CLIENT_SECRET"),
		tasksHiddenDir:   os.Getenv("ARENA_TASKS_HIDDEN_DIR"),
		subscriptions:    os.Getenv("ARENA_SUBSCRIPTIONS") == "true",
	}
	if v := os.Getenv("ARENA_RUN_CONCURRENCY"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			return config{}, errors.New("ARENA_RUN_CONCURRENCY must be an integer >= 1")
		}
		cfg.runConcurrency = n
	}
	cfg.adminEmails = []string{ownerEmail}
	for _, e := range strings.Split(os.Getenv("ARENA_ADMIN_EMAILS"), ",") {
		if e = strings.TrimSpace(e); e != "" {
			cfg.adminEmails = append(cfg.adminEmails, e)
		}
	}
	host, _, err := net.SplitHostPort(cfg.addr)
	if err != nil || net.ParseIP(host) == nil {
		return config{}, errors.New("ARENA_ADDR must be an ip:port")
	}
	if !net.ParseIP(host).IsLoopback() && !cfg.allowNonLoopback {
		return config{}, errors.New("ARENA_ADDR must be a loopback address; a reverse proxy is expected in front (set ARENA_ALLOW_NON_LOOPBACK=true inside a container)")
	}
	if cfg.databaseURL == "" {
		return config{}, errors.New("ARENA_APP_DATABASE_URL is required")
	}
	if cfg.subscriptions && cfg.secureCookies {
		// A personal subscription is for its owner's own use: never behind a public site.
		return config{}, errors.New("ARENA_SUBSCRIPTIONS is for local runs; it cannot be on with ARENA_SECURE_COOKIES=true")
	}
	for _, p := range [][3]string{{"GITHUB", cfg.githubID, cfg.githubSecret}, {"GOOGLE", cfg.googleID, cfg.googleSecret}} {
		if (p[1] == "") != (p[2] == "") {
			return config{}, fmt.Errorf("set both ARENA_%s_CLIENT_ID and ARENA_%s_CLIENT_SECRET, or neither", p[0], p[0])
		}
	}
	// No sign-in provider means nobody can sign in on the real site: refuse to start rather than run half-broken.
	if cfg.githubID == "" && cfg.googleID == "" {
		return config{}, errors.New("no sign-in provider: set ARENA_GITHUB_CLIENT_ID/SECRET and/or ARENA_GOOGLE_CLIENT_ID/SECRET (locally: put them in ~/.config/tolerance/env, values from /opt/tolerance/.env on the server)")
	}
	if !strings.HasPrefix(cfg.publicURL, "http://") && !strings.HasPrefix(cfg.publicURL, "https://") {
		return config{}, errors.New("ARENA_PUBLIC_URL (http:// or https://) is required when a sign-in provider is configured")
	}
	return cfg, nil
}

// providersFromConfig builds the sign-in providers that have both keys set.
func providersFromConfig(cfg config) map[string]identity.Provider {
	ps := map[string]identity.Provider{}
	if cfg.githubID != "" {
		ps["github"] = &identity.GitHub{ClientID: cfg.githubID, ClientSecret: cfg.githubSecret}
	}
	if cfg.googleID != "" {
		ps["google"] = &identity.Google{ClientID: cfg.googleID, ClientSecret: cfg.googleSecret}
	}
	return ps
}

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
