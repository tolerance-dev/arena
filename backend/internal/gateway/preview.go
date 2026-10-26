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
	"strconv"
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
// the run's snapshot image (on a network of its own with only the gateway, sandbox.CreateNetwork) and stopped when
// idle. Serve it only on the gateway's public addresses: sandboxes reach the gateway too, and must not see other
// runs' apps.
type Previews struct {
	pool      *db.Pool
	domain    string // e.g. preview.localhost
	prefix    string // before the run hex in the first label, e.g. "p-"; "" = the label is the hex
	ancestors string // origin allowed to frame previews (the site)
	site      string // the site's origin, for the busy page's screenshot and link; "" when unknown
	max       int    // previews running (or starting) at once
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
	// A preview nobody has asked for in this long is stopped.
	previewIdle = 10 * time.Minute
	// A preview asked for within this long is being watched: when all slots are taken, a new viewer gets the busy
	// page instead of stopping it under someone.
	previewInUse = 2 * time.Minute
	previewStart = 120 * time.Second
)

// errBusy: every slot holds a preview someone is watching.
var errBusy = errors.New("all previews are busy")

var labelRe = regexp.MustCompile(`^[0-9a-f]{32}$`)

// NewPreviews serves previews, at most limit at once (each takes up to sandbox.AppSpec's memory).
func NewPreviews(pool *db.Pool, domain, prefix, siteURL string, limit int, log *slog.Logger) *Previews {
	anc, site := "'self'", ""
	if u, err := url.Parse(siteURL); err == nil && u.Scheme != "" && u.Host != "" {
		site = u.Scheme + "://" + u.Host
		anc = site
	}
	return &Previews{pool: pool, domain: strings.ToLower(domain), prefix: strings.ToLower(prefix), ancestors: anc, site: site,
		max: max(1, limit), log: log.With("component", "preview"), running: map[string]*preview{}}
}

// containerName is the preview's container and its network.
func containerName(label string) string { return "arena-preview-" + label }

// drop removes a preview's container and network, best effort.
func drop(label string) {
	sandbox.Remove(containerName(label))
	sandbox.RemoveNetwork(containerName(label))
}

// Run reaps idle previews until ctx ends.
func (p *Previews) Run(ctx context.Context) {
	sandbox.RemoveByLabel(ctx, "arena.role=preview")
	sandbox.RemoveNetworks(ctx, "arena.role=preview")
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			sandbox.RemoveByLabel(context.Background(), "arena.role=preview")
			sandbox.RemoveNetworks(context.Background(), "arena.role=preview")
			return
		case <-t.C:
		}
		p.mu.Lock()
		for label, pv := range p.running {
			if !pv.starting && time.Since(pv.lastUsed) > previewIdle {
				delete(p.running, label)
				go drop(label)
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
	if errors.Is(err, errBusy) {
		page(w, http.StatusServiceUnavailable, "All previews are busy", "Other people are watching the apps that run right now. "+
			"This page tries again by itself; meanwhile, here is how this app looked when it was checked.", 15, p.busyExtra(label))
		return
	}
	if err != nil {
		page(w, http.StatusNotFound, "Preview unavailable", err.Error(), 0, "")
		return
	}
	if pv.failed != "" {
		page(w, http.StatusBadGateway, "The app did not start", pv.failed, 0, "")
		return
	}
	if !pv.ready {
		page(w, http.StatusServiceUnavailable, "Starting the app…", "The agent's app is booting from its snapshot. This page refreshes by itself.", 2, "")
		return
	}
	target, _ := url.Parse("http://" + containerName(label) + ":" + sandbox.AppPort)
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
			page(w, http.StatusBadGateway, "The app stopped", "It will be started again on the next request.", 2, "")
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
	if len(p.running) >= p.max && !p.makeRoom() {
		return nil, errBusy
	}
	pv := &preview{label: label, lastUsed: time.Now(), starting: true}
	p.running[label] = pv
	go p.start(pv, runs.ImageFor(runID))
	return pv, nil
}

// makeRoom frees one slot (p.mu held): a preview that failed to start, else the least recently used one nobody has
// watched for previewInUse. Starting previews keep their slot. It reports whether a slot was freed.
func (p *Previews) makeRoom() bool {
	var failed, idle *preview
	for _, pv := range p.running {
		switch {
		case pv.starting:
		case pv.failed != "":
			failed = pv
		case time.Since(pv.lastUsed) >= previewInUse && (idle == nil || pv.lastUsed.Before(idle.lastUsed)):
			idle = pv
		}
	}
	victim := failed
	if victim == nil {
		victim = idle
	}
	if victim == nil {
		return false
	}
	delete(p.running, victim.label)
	go drop(victim.label)
	return true
}

// busyExtra is the busy page's screenshot of the run and a link to its page (HTML; label is checked hex).
func (p *Previews) busyExtra(label string) string {
	if p.site == "" {
		return ""
	}
	run := p.site + "/r/run_" + label
	return `<img src="` + p.site + `/api/v1/runs/run_` + label + `/shot.jpg" alt="" onerror="this.remove()">` +
		`<p><a href="` + run + `" target="_top">Open the run page</a></p>`
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
	drop(pv.label)
	if !sandbox.ImageExists(ctx, image) {
		set(false, "the run's snapshot image is gone")
		return
	}
	err := sandbox.CreateNetwork(ctx, name, "preview")
	// The same container the check ran the app in (sandbox.AppSpec), so what passed the check starts here too.
	var id string
	if err == nil {
		id, err = sandbox.Create(ctx, sandbox.AppSpec(name, image, name, map[string]string{"arena.role": "preview"}))
	}
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
		resp, err := client.Get("http://" + name + ":" + sandbox.AppPort + "/")
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

// page is the gateway's own page in place of the app: refresh > 0 reloads it after that many seconds; extra is
// trusted HTML put under the text.
func page(w http.ResponseWriter, status int, title, text string, refresh int, extra string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	meta := ""
	if refresh > 0 {
		meta = `<meta http-equiv="refresh" content="` + strconv.Itoa(refresh) + `">`
	}
	_, _ = w.Write([]byte(`<!doctype html><html><head><meta charset="utf-8">` + meta + `<title>` + html.EscapeString(title) +
		`</title><style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f2f3f0;color:#1b1f1d}` +
		`h1{font-size:1.4rem;font-weight:600;letter-spacing:-.01em}main{max-width:40rem;padding:1.5rem;text-align:center}p{color:#5a625d}` +
		`img{display:block;max-width:100%;margin:1.25rem auto 0;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.15)}a{color:inherit;font-weight:600}` +
		`</style></head><body><main><h1>` + html.EscapeString(title) + `</h1><p>` + html.EscapeString(text) + `</p>` + extra + `</main></body></html>`))
}
