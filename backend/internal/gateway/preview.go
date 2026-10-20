package gateway

import (
	"context"
	"errors"
	"html"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/platform/db"
	"tolerance/internal/runs"
	"tolerance/internal/sandbox"
)

// Previews serves each finished run's app live at http://<prefix><run-hex>.<domain>/ (locally <hex>.preview.localhost,
// in prod p-<hex>.tolerance.cc). The app is started on demand from
// the run's snapshot image (on the sandbox network, so only the gateway can reach it) and stopped when idle.
type Previews struct {
	pool      *db.Pool
	domain    string // e.g. preview.localhost
	prefix    string // before the run hex in the first label, e.g. "p-"; "" = the label is the hex
	ancestors string // origin allowed to frame previews (the site)
	log       *slog.Logger

	mu      sync.Mutex
	running map[string]*preview
}

type preview struct {
	label    string
	lastUsed time.Time
	ready    bool
	failed   string
	starting bool
}

const (
	previewIdle  = 15 * time.Minute
	previewMax   = 4
	previewStart = 120 * time.Second
)

var labelRe = regexp.MustCompile(`^[0-9a-f]{32}$`)

func NewPreviews(pool *db.Pool, domain, prefix, siteURL string, log *slog.Logger) *Previews {
	anc := "'self'"
	if u, err := url.Parse(siteURL); err == nil && u.Scheme != "" && u.Host != "" {
		anc = u.Scheme + "://" + u.Host
	}
	return &Previews{pool: pool, domain: strings.ToLower(domain), prefix: strings.ToLower(prefix), ancestors: anc, log: log.With("component", "preview"),
		running: map[string]*preview{}}
}

func containerName(label string) string { return "arena-preview-" + label }

// Run reaps idle previews until ctx ends.
func (p *Previews) Run(ctx context.Context) {
	sandbox.RemoveByLabel(ctx, "arena.role=preview")
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			sandbox.RemoveByLabel(context.Background(), "arena.role=preview")
			return
		case <-t.C:
		}
		p.mu.Lock()
		for label, pv := range p.running {
			if !pv.starting && time.Since(pv.lastUsed) > previewIdle {
				delete(p.running, label)
				go sandbox.Remove(containerName(label))
			}
		}
		p.mu.Unlock()
	}
}

func (p *Previews) label(host string) string {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.ToLower(host)
	label, ok := strings.CutSuffix(host, "."+p.domain)
	if ok {
		label, ok = strings.CutPrefix(label, p.prefix)
	}
	if !ok || !labelRe.MatchString(label) {
		return ""
	}
	return label
}

func (p *Previews) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	label := p.label(r.Host)
	if label == "" {
		http.Error(w, "unknown preview", http.StatusNotFound)
		return
	}
	pv, err := p.ensure(r.Context(), label)
	if err != nil {
		page(w, http.StatusNotFound, "Preview unavailable", err.Error(), false)
		return
	}
	if pv.failed != "" {
		page(w, http.StatusBadGateway, "The app did not start", pv.failed, false)
		return
	}
	if !pv.ready {
		page(w, http.StatusServiceUnavailable, "Starting the app…", "The agent's app is booting from its snapshot. This page refreshes by itself.", true)
		return
	}
	target, _ := url.Parse("http://" + containerName(label) + ":3000")
	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.SetXForwarded()
			pr.Out.Host = r.Host
		},
		ModifyResponse: func(resp *http.Response) error {
			resp.Header.Del("X-Frame-Options")
			if resp.Header.Get("Content-Security-Policy") == "" {
				resp.Header.Set("Content-Security-Policy", "frame-ancestors "+p.ancestors)
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			p.mu.Lock()
			delete(p.running, label)
			p.mu.Unlock()
			page(w, http.StatusBadGateway, "The app stopped", "It will be started again on the next request.", true)
		},
	}
	proxy.ServeHTTP(w, r)
}

// ensure returns the preview for label, starting its container when needed.
func (p *Previews) ensure(ctx context.Context, label string) (*preview, error) {
	p.mu.Lock()
	if pv, ok := p.running[label]; ok {
		pv.lastUsed = time.Now()
		p.mu.Unlock()
		return pv, nil
	}
	p.mu.Unlock()

	runID := "run_" + label
	var ok bool
	err := p.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT status = 'done' AND app_started AND image IS NOT NULL FROM runs WHERE id = $1`, runID).Scan(&ok)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("no such run")
	}
	if err != nil {
		return nil, errors.New("database unavailable")
	}
	if !ok {
		return nil, errors.New("this run has no app to preview")
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if pv, ok := p.running[label]; ok {
		return pv, nil
	}
	if len(p.running) >= previewMax {
		p.evictOldest()
	}
	pv := &preview{label: label, lastUsed: time.Now(), starting: true}
	p.running[label] = pv
	go p.start(pv, runs.ImageFor(runID))
	return pv, nil
}

func (p *Previews) evictOldest() {
	var ls []*preview
	for _, pv := range p.running {
		if !pv.starting {
			ls = append(ls, pv)
		}
	}
	if len(ls) == 0 {
		return
	}
	sort.Slice(ls, func(i, j int) bool { return ls[i].lastUsed.Before(ls[j].lastUsed) })
	delete(p.running, ls[0].label)
	go sandbox.Remove(containerName(ls[0].label))
}

func (p *Previews) start(pv *preview, image string) {
	ctx, cancel := context.WithTimeout(context.Background(), previewStart+30*time.Second)
	defer cancel()
	set := func(ready bool, failed string) {
		p.mu.Lock()
		pv.ready, pv.failed, pv.starting = ready, failed, false
		p.mu.Unlock()
	}
	name := containerName(pv.label)
	sandbox.Remove(name)
	if !sandbox.ImageExists(ctx, image) {
		set(false, "the run's snapshot image is gone")
		return
	}
	id, err := sandbox.Create(ctx, sandbox.Spec{
		Name: name, Image: image, Network: sandbox.Network, Memory: "1g", CPUs: "1", Pids: 1024, Workdir: "/work",
		Labels: map[string]string{"arena.role": "preview"},
		Env:    []string{"PORT=3000", "HOST=0.0.0.0", "NODE_ENV=production", "HOME=/tmp", "ANTHROPIC_API_KEY=", "OPENAI_API_KEY="},
		Cmd:    []string{"sh", "-c", "cd /work && exec sh start.sh"},
	})
	if err == nil {
		err = sandbox.StartDetached(ctx, id)
	}
	if err != nil {
		p.log.Error("start preview", "label", pv.label, "err", err)
		set(false, "could not start the container")
		return
	}
	client := &http.Client{Timeout: 3 * time.Second}
	deadline := time.Now().Add(previewStart)
	for time.Now().Before(deadline) {
		resp, err := client.Get("http://" + name + ":3000/")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode < 500 {
				set(true, "")
				return
			}
		}
		if !sandbox.Running(ctx, name) {
			set(false, "start.sh exited")
			return
		}
		time.Sleep(time.Second)
	}
	set(false, "nothing answered on port 3000 within two minutes")
}

func page(w http.ResponseWriter, status int, title, text string, refresh bool) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	meta := ""
	if refresh {
		meta = `<meta http-equiv="refresh" content="2">`
	}
	_, _ = w.Write([]byte(`<!doctype html><html><head><meta charset="utf-8">` + meta + `<title>` + html.EscapeString(title) +
		`</title><style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f2f3f0;color:#1b1f1d}` +
		`h1{font-size:1.4rem;font-weight:600;letter-spacing:-.01em}main{max-width:28rem;padding:1.5rem;text-align:center}p{color:#5a625d}</style></head><body><main><h1>` + html.EscapeString(title) +
		`</h1><p>` + html.EscapeString(text) + `</p></main></body></html>`))
}
