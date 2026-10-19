package main

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"

	"tolerance/internal/identity"
)

type config struct {
	addr             string
	databaseURL      string
	adminEmails      []string
	secureCookies    bool
	devLogin         bool
	noLimits         bool // ARENA_NO_LIMITS: daily/hourly quotas off (local runs)
	trustProxy       bool // ARENA_TRUST_PROXY: take the client IP from X-Real-IP
	allowNonLoopback bool
	secretKey        string // ARENA_SECRET_KEY: seals agents' LLM keys (the gateway opens them)
	publicURL        string
	previewURL       string // ARENA_PREVIEW_URL: live preview address with {id}, e.g. http://{id}.preview.localhost:3023
	runConcurrency   int
	judgeModel       string
	githubID         string
	githubSecret     string
	googleID         string
	googleSecret     string
	tasksHiddenDir   string // ARENA_TASKS_HIDDEN_DIR: <slug>/judge.md overrides (the private arena-tasks repo)
}

func loadConfig() (config, error) {
	cfg := config{
		addr:             env("ARENA_ADDR", "127.0.0.1:8080"),
		databaseURL:      os.Getenv("ARENA_APP_DATABASE_URL"),
		secureCookies:    os.Getenv("ARENA_SECURE_COOKIES") == "true",
		devLogin:         os.Getenv("ARENA_DEV_LOGIN") == "true",
		noLimits:         os.Getenv("ARENA_NO_LIMITS") == "true",
		trustProxy:       os.Getenv("ARENA_TRUST_PROXY") == "true",
		allowNonLoopback: os.Getenv("ARENA_ALLOW_NON_LOOPBACK") == "true",
		secretKey:        os.Getenv("ARENA_SECRET_KEY"),
		publicURL:        os.Getenv("ARENA_PUBLIC_URL"),
		previewURL:       os.Getenv("ARENA_PREVIEW_URL"),
		runConcurrency:   1,
		judgeModel:       os.Getenv("ARENA_JUDGE_MODEL"),
		githubID:         os.Getenv("ARENA_GITHUB_CLIENT_ID"),
		githubSecret:     os.Getenv("ARENA_GITHUB_CLIENT_SECRET"),
		googleID:         os.Getenv("ARENA_GOOGLE_CLIENT_ID"),
		googleSecret:     os.Getenv("ARENA_GOOGLE_CLIENT_SECRET"),
		tasksHiddenDir:   os.Getenv("ARENA_TASKS_HIDDEN_DIR"),
	}
	if v := os.Getenv("ARENA_RUN_CONCURRENCY"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			return config{}, errors.New("ARENA_RUN_CONCURRENCY must be an integer >= 1")
		}
		cfg.runConcurrency = n
	}
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
	if cfg.devLogin || cfg.noLimits {
		// Dev login makes every user an admin: never next to a public origin.
		if u, err := url.Parse(cfg.publicURL); cfg.publicURL != "" && (err != nil || !isLocalHost(u.Hostname())) {
			return config{}, errors.New("ARENA_DEV_LOGIN and ARENA_NO_LIMITS are for local runs; ARENA_PUBLIC_URL must be localhost, 127.0.0.1 or *.localhost")
		}
	}
	if cfg.devLogin && cfg.secureCookies {
		return config{}, errors.New("ARENA_DEV_LOGIN is for local runs and CI; it cannot be on with ARENA_SECURE_COOKIES=true")
	}
	if cfg.noLimits && cfg.secureCookies {
		return config{}, errors.New("ARENA_NO_LIMITS is for local runs; it cannot be on with ARENA_SECURE_COOKIES=true")
	}
	for _, p := range [][3]string{{"GITHUB", cfg.githubID, cfg.githubSecret}, {"GOOGLE", cfg.googleID, cfg.googleSecret}} {
		if (p[1] == "") != (p[2] == "") {
			return config{}, fmt.Errorf("set both ARENA_%s_CLIENT_ID and ARENA_%s_CLIENT_SECRET, or neither", p[0], p[0])
		}
	}
	if (cfg.githubID != "" || cfg.googleID != "") && !strings.HasPrefix(cfg.publicURL, "http://") && !strings.HasPrefix(cfg.publicURL, "https://") {
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

func isLocalHost(h string) bool {
	return h == "localhost" || strings.HasSuffix(h, ".localhost") || net.ParseIP(h).IsLoopback()
}
