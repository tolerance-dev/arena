package runs

import (
	"archive/tar"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/platform/db"
	"tolerance/internal/platform/httpx"
	"tolerance/internal/sandbox"
	"tolerance/internal/tasks"
)

// The agent at work, live. While the agent runs, the worker samples its workspace every liveEvery: docker diff finds
// what the agent wrote, docker cp reads the source folders out (dependency folders stay in), so nothing runs inside
// the sandbox. It keeps the latest body of each text file and how the workspace grew, and, while someone watches the
// run page, now and then starts the app from a snapshot of the workspace taken on the fly. The gateway probes those
// apps (LivePending, MarkLiveReady) and serves the last one that answered (LiveTarget) at the run's preview address.
// Everything here works per run, so a page can show any number of runs building side by side.

const (
	liveEvery      = 4 * time.Second
	liveFileMax    = 256 << 10 // bigger files are listed without a body
	liveReadMax    = 16 << 20  // what one sample reads out of the workspace at most
	livePreviewGap = 25 * time.Second
	liveWatched    = 90 * time.Second // apps are started only for a run someone looked at within this long
	liveSeriesGap  = 15 * time.Second // a point of the growth series at least this often, changes or not
)

// LiveFile is a file of the workspace as last sampled; times are seconds since the agent started.
type LiveFile struct {
	Path     string `json:"path"`
	Lines    int    `json:"lines"`
	LOC      int    `json:"loc"` // non-blank lines when it's code (the same count as the run's stats), else 0
	Bytes    int    `json:"bytes"`
	Text     bool   `json:"text"` // its body is kept (LiveFileBody)
	AddedS   int    `json:"added_s"`
	ChangedS int    `json:"changed_s"`
}

// LivePoint is the workspace at one moment: t seconds since the agent started.
type LivePoint struct {
	T      int   `json:"t"`
	Files  int   `json:"files"`
	LOC    int   `json:"loc"`
	Tokens int64 `json:"tokens"`
}

// Live is what the run page polls while the agent works (and keeps showing after: the workspace as the agent left it).
type Live struct {
	Files        []LiveFile  `json:"files"`
	Series       []LivePoint `json:"series"`
	PreviewReady int         `json:"preview_ready"`         // grows each time a newer app answers: reload the frame
	PreviewURL   string      `json:"preview_url,omitempty"` // while the agent works and an app answers
	UpdatedAt    *time.Time  `json:"updated_at"`
}

// LiveName is the container (and, with ':', the image tag) of the n-th app started from a run's workspace.
func LiveName(runID string, n int) string {
	return fmt.Sprintf("arena-live-%s-%d", PreviewHost(runID), n)
}

func liveImage(runID string, n int) string {
	return fmt.Sprintf("arena-live:%s-%d", PreviewHost(runID), n)
}

type liveEntry struct {
	LiveFile
	sum [32]byte
}

// liveSampler belongs to one agent container; sample and finish are called from one goroutine.
type liveSampler struct {
	w         *Worker
	c         claimed
	container string
	started   time.Time
	log       *slog.Logger

	files     map[string]*liveEntry
	series    []LivePoint
	lastPoint time.Time
	dirty     bool // sources changed since the last app was started

	mu          sync.Mutex // guards what the app builder touches
	building    bool
	preview     int   // the last app started
	apps        []int // apps whose container and image still exist
	lastPreview time.Time
	wg          sync.WaitGroup
}

func (w *Worker) newLiveSampler(c claimed, container string, log *slog.Logger) *liveSampler {
	return &liveSampler{w: w, c: c, container: container, started: time.Now(), log: log, files: map[string]*liveEntry{}}
}

// run samples until ctx ends.
func (s *liveSampler) run(ctx context.Context) {
	t := time.NewTicker(liveEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		if err := s.sample(ctx, true); err != nil && ctx.Err() == nil {
			s.log.Warn("live sample", "err", err)
		}
	}
}

// finish takes the last sample of the stopped agent's workspace and removes the apps started from it.
func (s *liveSampler) finish(ctx context.Context) {
	if err := s.sample(ctx, false); err != nil && ctx.Err() == nil {
		s.log.Warn("last live sample", "err", err)
	}
	s.wg.Wait()
	s.mu.Lock()
	apps := s.apps
	s.apps = nil
	s.mu.Unlock()
	for _, n := range apps {
		s.dropApp(n)
	}
}

func (s *liveSampler) dropApp(n int) {
	sandbox.Remove(LiveName(s.c.id, n))
	sandbox.RemoveImage(liveImage(s.c.id, n))
}

// liveTargets picks what to docker cp out of /work: the biggest subtrees with no skipped folder inside, so
// dependencies and build output never leave the container. rels are what docker diff reported, relative to /work.
func liveTargets(rels []string) []string {
	children := map[string][]string{}
	blocked := map[string]bool{} // a folder with a skipped one somewhere below
	seen := map[string]bool{}
	for _, r := range rels {
		if r == "" || seen[r] {
			continue
		}
		seen[r] = true
		parts := strings.Split(r, "/")
		skip := parts[0] == "data"
		for i, p := range parts {
			if skipDirs[p] {
				skip = true
				for j := 1; j <= i; j++ {
					blocked[strings.Join(parts[:j], "/")] = true
				}
				break
			}
		}
		if skip {
			continue
		}
		parent := path.Dir(r)
		if parent == "." {
			parent = ""
		}
		children[parent] = append(children[parent], r)
	}
	var out []string
	var walk func(dir string)
	walk = func(dir string) {
		for _, ch := range children[dir] {
			if blocked[ch] {
				walk(ch)
			} else {
				out = append(out, ch)
			}
		}
	}
	walk("")
	sort.Strings(out)
	return out
}

type liveRead struct {
	body []byte // nil when it isn't kept (too big or binary)
	size int
	sum  [32]byte
}

// read takes the source files out of the workspace.
func (s *liveSampler) read(ctx context.Context) (map[string]liveRead, error) {
	paths, err := sandbox.Diff(ctx, s.container)
	if err != nil {
		return nil, err
	}
	var rels []string
	for _, p := range paths {
		if rel, ok := strings.CutPrefix(p, "/work/"); ok {
			rels = append(rels, rel)
		}
	}
	out := map[string]liveRead{}
	total := 0
	for _, target := range liveTargets(rels) {
		if total > liveReadMax {
			break
		}
		dir := path.Dir(target)
		err := sandbox.StreamOut(ctx, s.container, "/work/"+target, func(r io.Reader) error {
			tr := tar.NewReader(r)
			for {
				h, err := tr.Next()
				if errors.Is(err, io.EOF) {
					return nil
				}
				if err != nil {
					return err
				}
				name := path.Clean(h.Name)
				if dir != "." {
					name = dir + "/" + name
				}
				if h.Typeflag != tar.TypeReg || skipped(name) || strings.HasPrefix(name, "../") {
					continue
				}
				f := liveRead{size: int(h.Size)}
				if h.Size <= liveFileMax && total+int(h.Size) <= liveReadMax {
					body, err := io.ReadAll(tr)
					if err != nil {
						return err
					}
					total += len(body)
					f.sum = sha256.Sum256(body)
					if !binary(body) {
						f.body = body
					}
				} else {
					f.sum = sha256.Sum256(fmt.Appendf(nil, "%d %d", h.Size, h.ModTime.UnixNano()))
				}
				out[name] = f
			}
		})
		if err != nil && ctx.Err() != nil {
			return nil, err
		}
		// Otherwise a target removed between diff and cp: what was under it reads as deleted.
	}
	return out, nil
}

// sample reads the workspace, stores what changed and, when apps may start, starts one from the workspace.
func (s *liveSampler) sample(ctx context.Context, running bool) error {
	read, err := s.read(ctx)
	if err != nil {
		return err
	}
	now := int(time.Since(s.started).Seconds())
	type upsert struct {
		path string
		body string
	}
	var ups []upsert
	var gone []string
	for name, f := range read {
		e := s.files[name]
		if e != nil && e.sum == f.sum {
			continue
		}
		if e == nil {
			e = &liveEntry{LiveFile: LiveFile{Path: name, AddedS: now}}
			s.files[name] = e
		}
		e.sum, e.ChangedS, e.Bytes, e.Text = f.sum, now, f.size, f.body != nil
		e.Lines, e.LOC = 0, 0
		if f.body != nil {
			e.Lines = strings.Count(string(f.body), "\n")
			if len(f.body) > 0 && f.body[len(f.body)-1] != '\n' {
				e.Lines++
			}
			_, e.LOC = codeLines(name, f.body)
			ups = append(ups, upsert{name, strings.ToValidUTF8(strings.ReplaceAll(string(f.body), "\x00", ""), "�")})
		}
	}
	for name := range s.files {
		if _, ok := read[name]; !ok {
			delete(s.files, name)
			gone = append(gone, name)
		}
	}
	changed := len(ups) > 0 || len(gone) > 0
	if changed {
		s.dirty = true
	}

	files := make([]LiveFile, 0, len(s.files))
	loc := 0
	for _, e := range s.files {
		files = append(files, e.LiveFile)
		loc += e.LOC
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })

	var watched bool
	var ready int
	err = s.w.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var tokens int64
		if err := tx.QueryRow(ctx, `SELECT tokens_in + tokens_out + tokens_cache_write FROM runs WHERE id = $1`, s.c.id).Scan(&tokens); err != nil {
			return err
		}
		if changed || time.Since(s.lastPoint) >= liveSeriesGap || !running {
			s.series = append(s.series, LivePoint{T: now, Files: len(files), LOC: loc, Tokens: tokens})
			s.lastPoint = time.Now()
		}
		filesJSON, _ := json.Marshal(files)
		seriesJSON, _ := json.Marshal(s.series)
		err := tx.QueryRow(ctx, `INSERT INTO run_live (run_id, files, series) VALUES ($1, $2, $3)
			ON CONFLICT (run_id) DO UPDATE SET files = $2, series = $3, updated_at = now()
			RETURNING coalesce(watched_at > now() - make_interval(secs => $4), false), preview_ready`,
			s.c.id, filesJSON, seriesJSON, liveWatched.Seconds()).Scan(&watched, &ready)
		if err != nil {
			return err
		}
		for _, u := range ups {
			if _, err := tx.Exec(ctx, `INSERT INTO run_live_files (run_id, path, body) VALUES ($1, $2, $3)
				ON CONFLICT (run_id, path) DO UPDATE SET body = $3, changed_at = now()`, s.c.id, u.path, u.body); err != nil {
				return err
			}
		}
		if len(gone) > 0 {
			_, err = tx.Exec(ctx, `DELETE FROM run_live_files WHERE run_id = $1 AND path = ANY($2)`, s.c.id, gone)
		}
		return err
	})
	if err != nil {
		return err
	}
	if running {
		s.manageApps(ctx, watched, ready)
	}
	return nil
}

// manageApps drops the apps nobody is served any more (all but the one answering and the newest) and starts a new one when
// the sources changed, someone watches and the last start was long enough ago.
func (s *liveSampler) manageApps(ctx context.Context, watched bool, ready int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	keep := s.apps[:0]
	for _, n := range s.apps {
		if n == ready || n == s.preview {
			keep = append(keep, n)
		} else {
			go s.dropApp(n)
		}
	}
	s.apps = keep
	_, hasStart := s.files["start.sh"]
	if s.building || !s.dirty || !watched || !hasStart || time.Since(s.lastPreview) < livePreviewGap {
		return
	}
	s.building, s.dirty, s.lastPreview = true, false, time.Now()
	s.preview++
	n := s.preview
	s.apps = append(s.apps, n)
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		err := s.startApp(ctx, n)
		s.mu.Lock()
		s.building = false
		s.mu.Unlock()
		if err != nil && ctx.Err() == nil {
			s.log.Warn("live app", "n", n, "err", err)
		}
	}()
}

// startApp snapshots the workspace as it is (the agent keeps running) and starts the app from it on the run's
// network, in the same container the check and the preview use (sandbox.AppSpec). The gateway takes it from there.
func (s *liveSampler) startApp(ctx context.Context, n int) error {
	image := liveImage(s.c.id, n)
	if err := sandbox.CommitRunning(ctx, s.container, image, "ENV ANTHROPIC_API_KEY=", "ENV OPENAI_API_KEY=", "ENV GEMINI_API_KEY=", `CMD ["sh"]`); err != nil {
		return err
	}
	id, err := sandbox.Create(ctx, sandbox.AppSpec(LiveName(s.c.id, n), image, s.c.network,
		map[string]string{"arena.run": s.c.id, "arena.role": "live"}))
	if err != nil {
		return err
	}
	if err := sandbox.StartDetached(ctx, id); err != nil {
		return err
	}
	return s.w.exec(ctx, `UPDATE run_live SET preview = $2 WHERE run_id = $1 AND preview < $2`, s.c.id, n)
}

// liveKeep is the image tags of live apps that may still be served: the runs whose agent works.
func liveKeep(ctx context.Context, tx pgx.Tx) (map[string]bool, error) {
	rows, err := tx.Query(ctx, `SELECT r.id, l.preview FROM runs r JOIN run_live l ON l.run_id = r.id WHERE r.status = 'agent'`)
	if err != nil {
		return nil, err
	}
	keep := map[string]bool{}
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		for k := 1; k <= n; k++ {
			keep[liveImage(id, k)] = true
		}
	}
	return keep, rows.Err()
}

// Live is a run's workspace as last sampled. A look at a run whose agent works marks it watched (apps start for it).
func (s *Service) Live(ctx context.Context, id string) (Live, error) {
	out := Live{Files: []LiveFile{}, Series: []LivePoint{}}
	var status, task string
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT status, task FROM runs WHERE id = $1`, id).Scan(&status, &task); err != nil {
			return err
		}
		var files, series []byte
		var updated time.Time
		err := tx.QueryRow(ctx, `UPDATE run_live SET watched_at = CASE WHEN $2 THEN now() ELSE watched_at END WHERE run_id = $1
			RETURNING files, series, preview_ready, updated_at`, id, status == "agent").Scan(&files, &series, &out.PreviewReady, &updated)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		updated = updated.UTC()
		out.UpdatedAt = &updated
		if err := json.Unmarshal(files, &out.Files); err != nil {
			return err
		}
		return json.Unmarshal(series, &out.Series)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return out, httpx.NotFound()
	}
	if t := tasks.BySlug(task); err == nil && status == "agent" && out.PreviewReady > 0 && s.PreviewURL != "" && t != nil && t.UI {
		out.PreviewURL = strings.ReplaceAll(s.PreviewURL, "{id}", PreviewHost(id))
	}
	return out, err
}

// LiveFileBody is the latest body of one file of a run's workspace.
func (s *Service) LiveFileBody(ctx context.Context, id, path string) (string, error) {
	var body string
	err := s.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT body FROM run_live_files WHERE run_id = $1 AND path = $2`, id, path).Scan(&body)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", httpx.NotFound()
	}
	return body, err
}

// LiveApp is an app started from a run's workspace that the gateway hasn't seen answering yet.
type LiveApp struct {
	RunID string
	N     int
}

// LivePending lists the newest app of each run whose agent works, when it hasn't answered yet.
func LivePending(ctx context.Context, pool *db.Pool) ([]LiveApp, error) {
	var out []LiveApp
	err := pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT l.run_id, l.preview FROM run_live l JOIN runs r ON r.id = l.run_id
			WHERE r.status = 'agent' AND l.preview > l.preview_ready`)
		if err != nil {
			return err
		}
		out, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (LiveApp, error) {
			var a LiveApp
			return a, row.Scan(&a.RunID, &a.N)
		})
		return err
	})
	return out, err
}

// MarkLiveReady records that the run's n-th app answers: the gateway serves it from now on.
func MarkLiveReady(ctx context.Context, pool *db.Pool, runID string, n int) error {
	return pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE run_live SET preview_ready = $2 WHERE run_id = $1 AND preview_ready < $2`, runID, n)
		return err
	})
}

// LiveTarget is the container that serves a run's preview while its agent works ("" = no app answers yet). agent is
// false once the run left the agent: the preview of the snapshot takes over.
func LiveTarget(ctx context.Context, pool *db.Pool, runID string) (container string, agent bool, err error) {
	var status string
	var ready int
	err = pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT r.status, coalesce(l.preview_ready, 0) FROM runs r LEFT JOIN run_live l ON l.run_id = r.id
			WHERE r.id = $1`, runID).Scan(&status, &ready)
	})
	if err != nil || status != "agent" {
		return "", false, err
	}
	if ready == 0 {
		return "", true, nil
	}
	return LiveName(runID, ready), true, nil
}

// RegisterLiveRoutes mounts the live reads (public, like the run itself).
func RegisterLiveRoutes(mux *http.ServeMux, s *Service) {
	mux.HandleFunc("GET /api/v1/runs/{id}/live", func(w http.ResponseWriter, r *http.Request) {
		live, err := s.Live(r.Context(), r.PathValue("id"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, live)
	})
	mux.HandleFunc("GET /api/v1/runs/{id}/live/file", func(w http.ResponseWriter, r *http.Request) {
		body, err := s.LiveFileBody(r.Context(), r.PathValue("id"), r.URL.Query().Get("path"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = io.WriteString(w, body)
	})
}
