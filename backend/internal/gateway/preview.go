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

	mu       sync.Mutex
	aliases  map[string]string // blind-vote alias → run hex, as looked up (aliases never change)
	running  map[string]*preview
	stopping map[string]chan struct{} // label → closed once its old container and network are gone
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
		max: max(1, limit), log: log.With("component", "preview"), aliases: map[string]string{}, running: map[string]*preview{}, stopping: map[string]chan struct{}{}}
}

// containerName is the preview's container and its network.
func containerName(label string) string { return "arena-preview-" + label }

// stop takes pv out of the running set and removes its container (p.mu held). Until that is done the label stays in
// p.stopping, so a new start of the same label waits instead of having its fresh container removed.
func (p *Previews) stop(pv *preview) {
	if p.running[pv.label] != pv {
		return
	}
	delete(p.running, pv.label)
	done := make(chan struct{})
	prev := p.stopping[pv.label]
	p.stopping[pv.label] = done
	go func() {
		if prev != nil {
			<-prev
		}
		drop(pv.label)
		close(done)
		p.mu.Lock()
		if p.stopping[pv.label] == done {
			delete(p.stopping, pv.label)
		}
		p.mu.Unlock()
	}()
}

// drop removes a preview's container and network, best effort.
func drop(label string) {
	sandbox.Remove(containerName(label))
	sandbox.RemoveNetwork(containerName(label))
}

// probeLive marks each app started from a working agent's workspace ready once it answers (runs.LivePending), so
// the run page reloads its frame onto it; the gateway is the one that reaches the run networks.
func (p *Previews) probeLive(ctx context.Context) {
	client := &http.Client{Timeout: 2 * time.Second}
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
		apps, err := runs.LivePending(ctx, p.pool)
		if err != nil {
			continue
		}
		for _, a := range apps {
			resp, err := client.Get("http://" + runs.LiveName(a.RunID, a.N) + ":" + sandbox.AppPort + "/")
			if err != nil {
				continue
			}
			resp.Body.Close()
			if resp.StatusCode < 500 {
				if err := runs.MarkLiveReady(ctx, p.pool, a.RunID, a.N); err != nil {
					p.log.Error("mark live app ready", "run_id", a.RunID, "err", err)
				}
			}
		}
	}
}

// Run reaps idle previews until ctx ends.
func (p *Previews) Run(ctx context.Context) {
	go p.probeLive(ctx)
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
		for _, pv := range p.running {
			if !pv.starting && time.Since(pv.lastUsed) > previewIdle {
				p.stop(pv)
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

// runOf maps a host label to the run hex it shows: a blind vote's alias (runs.Contender) stands for its run, so the
// voter can't read the run id off the address. blind says it was an alias.
func (p *Previews) runOf(ctx context.Context, label string) (hex string, blind bool) {
	p.mu.Lock()
	hex, ok := p.aliases[label]
	p.mu.Unlock()
	if ok {
		return hex, true
	}
	var run string
	err := p.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT CASE WHEN alias_a = $1 THEN run_a ELSE run_b END FROM vote_pairs
			WHERE alias_a = $1 OR alias_b = $1`, label).Scan(&run)
	})
	if err != nil {
		return label, false
	}
	hex = strings.TrimPrefix(run, "run_")
	p.mu.Lock()
	if len(p.aliases) > 10000 {
		clear(p.aliases)
	}
	p.aliases[label] = hex
	p.mu.Unlock()
	return hex, true
}

func (p *Previews) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	label := p.label(r.Host)
	if label == "" {
		http.Error(w, "unknown preview", http.StatusNotFound)
		return
	}
	label, blind := p.runOf(r.Context(), label)
	if !blind {
		// While the agent works, the address shows the app started from its workspace as it is (runs/live.go).
		target, agent, err := runs.LiveTarget(r.Context(), p.pool, "run_"+label)
		if err == nil && agent {
			if target == "" {
				page(w, http.StatusServiceUnavailable, "The agent is still building", "Its app is started from the workspace once it has "+
					"a start.sh and someone watches the run. This page refreshes by itself.", 5, "")
				return
			}
			p.proxy(w, r, target, func() {
				page(w, http.StatusBadGateway, "The app is restarting", "A newer build of it is on the way.", 3, "")
			})
			return
		}
	}
	pv, st, err := p.ensure(r.Context(), label)
	if errors.Is(err, errBusy) {
		page(w, http.StatusServiceUnavailable, "All previews are busy", "Other people are watching the apps that run right now. "+
			"This page tries again by itself; meanwhile, here is how this app looked when it was checked.", 15, p.busyExtra(label, blind))
		return
	}
	if err != nil {
		page(w, http.StatusNotFound, "Preview unavailable", err.Error(), 0, "")
		return
	}
	if st.failed != "" {
		page(w, http.StatusBadGateway, "The app did not start", st.failed, 0, "")
		return
	}
	if !st.ready {
		page(w, http.StatusServiceUnavailable, "Starting the app…", "The agent's app is booting from its snapshot. This page refreshes by itself.", 2, "")
		return
	}
	p.proxy(w, r, containerName(label), func() {
		p.mu.Lock()
		p.stop(pv)
		p.mu.Unlock()
		page(w, http.StatusBadGateway, "The app stopped", "It will be started again on the next request.", 2, "")
	})
}

// proxy passes the request to an app container, framed only by the site; failed answers the request when the app
// doesn't.
func (p *Previews) proxy(w http.ResponseWriter, r *http.Request, container string, failed func()) {
	target, _ := url.Parse("http://" + container + ":" + sandbox.AppPort)
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
			if r.Context().Err() != nil {
				return // the viewer went away mid-request: the app is fine
			}
			failed()
		},
	}
	proxy.ServeHTTP(w, r)
}

// state is a copy of a preview's progress, taken under p.mu.
type state struct {
	ready  bool
	failed string
}

// ensure returns the preview for label and its state, starting its container when needed.
func (p *Previews) ensure(ctx context.Context, label string) (*preview, state, error) {
	p.mu.Lock()
	if pv, ok := p.running[label]; ok {
		pv.lastUsed = time.Now()
		st := state{pv.ready, pv.failed}
		p.mu.Unlock()
		return pv, st, nil
	}
	p.mu.Unlock()

	runID := "run_" + label
	var ok bool
	err := p.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT status = 'done' AND app_started AND image IS NOT NULL FROM runs WHERE id = $1`, runID).Scan(&ok)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, state{}, errors.New("no such run")
	}
	if err != nil {
		return nil, state{}, errors.New("database unavailable")
	}
	if !ok {
		return nil, state{}, errors.New("this run has no app to preview")
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if pv, ok := p.running[label]; ok {
		pv.lastUsed = time.Now()
		return pv, state{pv.ready, pv.failed}, nil
	}
	// Previews still being removed hold their memory too. Freeing a slot for the newcomer means waiting for that
	// container to go before starting.
	var wait []chan struct{}
	if len(p.running)+len(p.stopping) >= p.max {
		victim := p.makeRoom()
		if victim == "" {
			return nil, state{}, errBusy
		}
		wait = append(wait, p.stopping[victim])
	}
	if ch := p.stopping[label]; ch != nil {
		wait = append(wait, ch)
	}
	pv := &preview{label: label, lastUsed: time.Now(), starting: true}
	p.running[label] = pv
	go p.start(pv, runs.ImageFor(runID), wait)
	return pv, state{}, nil
}

// makeRoom frees one slot (p.mu held): a preview that failed to start, else the least recently used one nobody has
// watched for previewInUse. Starting previews keep their slot. It returns the stopped label, "" when none could go.
func (p *Previews) makeRoom() string {
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
		return ""
	}
	p.stop(victim)
	return victim.label
}

// busyExtra is the busy page's screenshot of the run and a link to its page (HTML; label is checked hex); none for a
// blind-vote alias, since it would name the run.
func (p *Previews) busyExtra(label string, blind bool) string {
	if p.site == "" || blind {
		return ""
	}
	run := p.site + "/r/run_" + label
	return `<img src="` + p.site + `/api/v1/runs/run_` + label + `/shot.jpg" alt="" onerror="this.remove()">` +
		`<p><a href="` + run + `" target="_top">Open the run page</a></p>`
}

func (p *Previews) start(pv *preview, image string, wait []chan struct{}) {
	for _, ch := range wait {
		<-ch
	}
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
