package runs

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/agents"
	"tolerance/internal/platform/db"
	"tolerance/internal/platform/sanitize"
	"tolerance/internal/pricing"
	"tolerance/internal/sandbox"
	"tolerance/internal/tasks"
)

//go:embed verify.py
var verifyPy []byte

const (
	maxLog       = 64 << 10
	checkTimeout = 25 * time.Minute
	maxShot      = 3 << 20
	pollEvery    = 3 * time.Second
	verifyOutMax = 20 << 20
)

type WorkerConfig struct {
	Concurrency int           // runs in flight at once, on this worker and across all of them
	Drain       time.Duration // how long a stopping worker lets its runs finish before it gives them up
}

// Ownership: a worker registers in the workers table and beats there; the runs it claims carry its id
// (runs.worker_id), and only it touches their containers. A run in flight whose worker stopped beating for
// beatStale is lost: whichever worker reaps next marks it infra_error and removes its containers and network.
const (
	beatEvery = 10 * time.Second
	beatStale = time.Minute
	reapEvery = 30 * time.Second
)

type Worker struct {
	pool *db.Pool
	log  *slog.Logger
	cfg  WorkerConfig
	id   string
}

func NewWorker(pool *db.Pool, log *slog.Logger, cfg WorkerConfig) *Worker {
	if cfg.Concurrency < 1 {
		cfg.Concurrency = 1
	}
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	id := "w-" + hex.EncodeToString(b[:])
	return &Worker{pool: pool, log: log.With("worker", id), cfg: cfg, id: id}
}

func (w *Worker) exec(ctx context.Context, q string, args ...any) error {
	return w.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, q, args...)
		return err
	})
}

// Run claims queued runs until stop ends, then drains: no new claims, the runs in flight go on until they finish,
// cfg.Drain passes or abort ends; whatever is still running then is stopped and marked infra_error.
func (w *Worker) Run(stop, abort context.Context, host string) error {
	if err := w.exec(stop, `INSERT INTO workers (id, host) VALUES ($1, $2)`, w.id, host); err != nil {
		return fmt.Errorf("register worker: %w", err)
	}
	beatCtx, endBeat := context.WithCancel(context.Background())
	beatDone := make(chan struct{})
	go func() { defer close(beatDone); w.heartbeat(beatCtx, host) }()
	defer func() {
		endBeat()
		<-beatDone
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = w.exec(ctx, `DELETE FROM workers WHERE id = $1`, w.id)
	}()
	w.log.Info("worker started", "concurrency", w.cfg.Concurrency, "drain", w.cfg.Drain.String())

	w.reap(stop)
	_ = w.exec(stop, `DELETE FROM gateway_tokens WHERE expires_at < now()`)
	go w.collectImages(stop)
	go func() {
		for {
			select {
			case <-stop.Done():
				return
			case <-time.After(reapEvery):
			}
			w.reap(stop)
		}
	}()

	// Runs live on runCtx, not stop: a SIGTERM ends the claiming, not the runs.
	runCtx, cancelRuns := context.WithCancel(context.Background())
	defer cancelRuns()
	sem := make(chan struct{}, w.cfg.Concurrency)
	var wg sync.WaitGroup
	var inFlight sync.Map
claiming:
	for {
		select {
		case <-stop.Done():
			break claiming
		case sem <- struct{}{}:
		}
		id, err := w.claim(stop)
		if err != nil || id == "" {
			<-sem
			if err != nil && stop.Err() == nil {
				w.log.Error("claim run", "err", err)
			}
			select {
			case <-stop.Done():
				break claiming
			case <-time.After(2 * time.Second):
			}
			continue
		}
		wg.Add(1)
		inFlight.Store(id, true)
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			defer inFlight.Delete(id)
			w.process(runCtx, id)
		}()
	}

	var draining []string
	inFlight.Range(func(k, _ any) bool { draining = append(draining, k.(string)); return true })
	w.log.Info("worker stopping: draining runs in flight", "runs", draining, "drain", w.cfg.Drain.String())
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(w.cfg.Drain):
		w.log.Warn("drain ran out: stopping the runs still in flight")
		cancelRuns()
		<-done
	case <-abort.Done():
		w.log.Warn("worker aborted: stopping the runs still in flight")
		cancelRuns()
		<-done
	}
	w.log.Info("worker stopped")
	return nil
}

// heartbeat keeps this worker's row fresh, so nobody reaps its runs; a row reaped meanwhile (the database was out
// of reach for beatStale) is put back, its runs are already lost by then.
func (w *Worker) heartbeat(ctx context.Context, host string) {
	t := time.NewTicker(beatEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		err := w.exec(ctx, `INSERT INTO workers (id, host) VALUES ($1, $2)
			ON CONFLICT (id) DO UPDATE SET heartbeat_at = now()`, w.id, host)
		if err != nil && ctx.Err() == nil {
			w.log.Error("worker heartbeat", "err", err)
		}
	}
}

// reap marks lost runs (in flight, their worker gone) infra_error and removes the run containers and networks of
// this stack that no live run owns: leftovers of a crashed worker. The containers are listed before the database is
// read, so a run claimed meanwhile is already in flight when its containers are judged.
func (w *Worker) reap(ctx context.Context) {
	containers, err := sandbox.Containers(ctx, "arena.run")
	if err != nil {
		if ctx.Err() == nil {
			w.log.Error("list run containers", "err", err)
		}
		return
	}
	networks := sandbox.Networks(ctx, "arena.role=run")
	var lost, live []string
	err = w.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		// The same refund as refundQuota: an infra_error is the platform's fault and gives the run back.
		rows, err := tx.Query(ctx, `WITH f AS (UPDATE runs SET status = 'infra_error', finished_at = now(), updated_at = now(),
				failure_reason = 'the worker running it stopped (crash or restart) before the run finished'
			WHERE status IN ('agent', 'checking') AND worker_id IS DISTINCT FROM $1
				AND (worker_id IS NULL OR worker_id NOT IN (SELECT id FROM workers WHERE heartbeat_at > now() - make_interval(secs => $2)))
			RETURNING id), q AS (UPDATE run_quota SET refunded = true WHERE run_id IN (SELECT id FROM f))
			SELECT id FROM f`, w.id, beatStale.Seconds())
		if err != nil {
			return err
		}
		if lost, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM gateway_tokens WHERE run_id = ANY($1)`, lost); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM workers WHERE heartbeat_at <= now() - make_interval(secs => $1)`, beatStale.Seconds()); err != nil {
			return err
		}
		rows, err = tx.Query(ctx, `SELECT id FROM runs WHERE status IN ('agent', 'checking')`)
		if err != nil {
			return err
		}
		live, err = pgx.CollectRows(rows, pgx.RowTo[string])
		return err
	})
	if err != nil {
		if ctx.Err() == nil {
			w.log.Error("reap lost runs", "err", err)
		}
		return
	}
	for _, id := range lost {
		w.log.Warn("run lost: its worker stopped", "run_id", id)
	}
	keep := map[string]bool{}
	for _, id := range live {
		keep[id] = true
		keep["arena-run-"+PreviewHost(id)] = true
	}
	for c, run := range containers {
		if !keep[run] {
			sandbox.Remove(c)
			w.log.Info("removed leftover run container", "container", c, "run_id", run)
		}
	}
	for _, n := range networks {
		if !keep[n] {
			sandbox.RemoveNetwork(n)
			w.log.Info("removed leftover run network", "network", n)
		}
	}
}

// collectImages removes run snapshots nobody needs any more, hourly: everything finished more than a day ago
// except each agent's best run per task and limits (the leaderboard's run among them, so its live preview keeps
// working; the leaderboard leaves out runs over the task's limits).
func (w *Worker) collectImages(ctx context.Context) {
	for {
		keep := map[string]bool{}
		err := w.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
			// By id, not the image column: a snapshot exists a moment before the column is set.
			rows, err := tx.Query(ctx, `SELECT id FROM runs WHERE
					status IN ('queued', 'agent', 'checking') OR finished_at IS NULL OR finished_at > now() - interval '1 day'
					OR id IN (SELECT DISTINCT ON (agent_id, task, time_limit_s, token_budget) id FROM runs WHERE status = 'done' AND score IS NOT NULL
						ORDER BY agent_id, task, time_limit_s, token_budget, score DESC, tokens_in + tokens_out + tokens_cache_write, agent_seconds NULLS LAST)`)
			if err != nil {
				return err
			}
			defer rows.Close()
			for rows.Next() {
				var id string
				if err := rows.Scan(&id); err != nil {
					return err
				}
				keep[ImageFor(id)] = true
			}
			return rows.Err()
		})
		if err == nil {
			images, _ := sandbox.Images(ctx, "arena-run")
			for _, img := range images {
				if keep[img] {
					continue
				}
				sandbox.RemoveImage(img)
				_ = w.exec(ctx, `UPDATE runs SET image = NULL WHERE image = $1`, img)
				w.log.Info("removed run snapshot", "image", img)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Hour):
		}
	}
}

func (w *Worker) claim(ctx context.Context) (string, error) {
	var id string
	err := w.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, queueLock); err != nil {
			return err
		}
		// The concurrency caps runs in flight across every worker, so one starting while another drains doesn't
		// put twice the agents on the host. A recheck skips the agent: straight to checking, keeping when the agent
		// started.
		return tx.QueryRow(ctx, `UPDATE runs SET status = CASE WHEN recheck THEN 'checking' ELSE 'agent' END, worker_id = $1,
				started_at = CASE WHEN recheck THEN started_at ELSE now() END, updated_at = now()
			WHERE status = 'queued' AND NOT coalesce((SELECT runs_paused FROM settings), false)
				AND (SELECT count(*) FROM runs WHERE status IN ('agent', 'checking')) < $2
				AND id = (SELECT id FROM (`+queueOrder+`) head ORDER BY `+queueSort+` LIMIT 1)
			RETURNING id`, w.id, w.cfg.Concurrency).Scan(&id)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

type claimed struct {
	id, task, agentID string
	provider          string // where the agent's key is spent: run.sh picks model names by it (ARENA_PROVIDER)
	model             string // a ready agent's catalog model: MODEL is its id at this provider
	network           string // the run's own internal network (sandbox.CreateNetwork)
	timeLimit         time.Duration
	budget            int64
	bundle            []byte
	recheck           bool // only check the kept snapshot (Service.Recheck)
}

func (w *Worker) process(ctx context.Context, id string) {
	log := w.log.With("run_id", id)
	var c claimed
	c.id = id
	var limitS int
	err := w.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT r.task, r.agent_id, a.provider, a.model, r.time_limit_s, r.token_budget, a.bundle, r.recheck
			FROM runs r JOIN agents a ON a.id = r.agent_id WHERE r.id = $1`, id).Scan(&c.task, &c.agentID, &c.provider, &c.model, &limitS, &c.budget, &c.bundle, &c.recheck)
	})
	c.timeLimit = time.Duration(limitS) * time.Second
	// The agent, and later the app and the checker, live on the run's own network with only the gateway.
	c.network = "arena-run-" + PreviewHost(id)
	if err == nil {
		if err = sandbox.CreateNetwork(ctx, c.network, "run"); err == nil {
			defer sandbox.RemoveNetwork(c.network)
		}
	}
	if err == nil && !c.recheck {
		err = w.build(ctx, c, log)
	}
	if err == nil {
		err = w.check(ctx, c, log)
	}
	if ctx.Err() != nil {
		// The worker gave the run up (drain ran out or abort): its containers are gone with the deferred removes.
		log.Warn("run stopped by the worker shutting down")
		_ = w.exec(context.Background(), refundQuota(`UPDATE runs SET status = 'infra_error', finished_at = now(), updated_at = now(),
			failure_reason = 'the worker shut down before the run finished' WHERE id = $1 AND status IN ('agent', 'checking')
			RETURNING id`), id)
	} else if err != nil {
		log.Error("run failed", "err", err)
		reason := err.Error()
		if len(reason) > 500 {
			reason = reason[:500]
		}
		_ = w.exec(context.Background(), refundQuota(`UPDATE runs SET status = 'infra_error', failure_reason = $2, finished_at = now(), updated_at = now()
			WHERE id = $1 AND status IN ('agent', 'checking') RETURNING id`), id, reason)
	}
	_ = w.exec(context.Background(), `DELETE FROM gateway_tokens WHERE run_id = $1`, id)
}

func newToken() (token, hash string) {
	var b [24]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	token = "arena-run-" + hex.EncodeToString(b[:])
	sum := sha256.Sum256([]byte(token))
	return token, hex.EncodeToString(sum[:])
}

// TokenHash is how the gateway looks a token up.
func TokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (w *Worker) issueToken(ctx context.Context, runID, purpose string, ttl time.Duration) (string, error) {
	token, hash := newToken()
	err := w.exec(ctx, `INSERT INTO gateway_tokens (token_hash, run_id, purpose, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
		hash, runID, purpose, ttl.Seconds())
	return token, err
}

// stillActive reports whether the run is still in status (a cancel flips it).
func (w *Worker) stillActive(ctx context.Context, id, status string) bool {
	var s string
	err := w.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT status FROM runs WHERE id = $1`, id).Scan(&s)
	})
	return err != nil || s == status // on a db error, keep going
}

// build runs the agent in its sandbox and snapshots the workspace into an image.
func (w *Worker) build(ctx context.Context, c claimed, log *slog.Logger) error {
	task := tasks.BySlug(c.task)
	if task == nil {
		return errors.New("the task left the catalog")
	}
	bundle, err := agents.BundleFiles(c.bundle)
	if err != nil {
		return fmt.Errorf("agent bundle: %w", err)
	}
	token, err := w.issueToken(ctx, c.id, "agent", c.timeLimit+10*time.Minute)
	if err != nil {
		return err
	}
	deadline := time.Now().Add(c.timeLimit)
	gw := sandbox.GatewayURL
	spec := sandbox.Spec{
		Name: "arena-agent-" + PreviewHost(c.id), Image: sandbox.Image, Network: c.network,
		Memory: "6g", CPUs: "2", Pids: 4096, Workdir: "/work",
		Labels: map[string]string{"arena.run": c.id, "arena.role": "agent"},
		Env: []string{
			"ANTHROPIC_BASE_URL=" + gw + "/anthropic", "ANTHROPIC_API_KEY=" + token,
			"OPENAI_BASE_URL=" + gw + "/openai/v1", "OPENAI_API_KEY=" + token,
			"GOOGLE_GEMINI_BASE_URL=" + gw + "/gemini", "GEMINI_API_KEY=" + token,
			"npm_config_registry=" + gw + "/npm/", "PIP_INDEX_URL=" + gw + "/pypi/simple/", "PIP_TRUSTED_HOST=gateway",
			"ARENA_TASK=" + c.task, "ARENA_PROVIDER=" + c.provider, fmt.Sprintf("ARENA_TIME_LIMIT_S=%d", int(c.timeLimit.Seconds())),
			fmt.Sprintf("ARENA_DEADLINE=%d", deadline.Unix()), fmt.Sprintf("ARENA_TOKEN_BUDGET=%d", c.budget),
			"TASK_FILE=/work/TASK.md", "IS_SANDBOX=1", "DISABLE_AUTOUPDATER=1", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
			"DISABLE_TELEMETRY=1", "DO_NOT_TRACK=1", "CI=1", "HOME=/root",
		},
		Cmd: []string{"sh", "-c", "chmod +x /agent/run.sh 2>/dev/null; cd /work && exec /agent/run.sh"},
	}
	if m := pricing.BySlug(c.model); m != nil {
		if mid, ok := m.IDs[c.provider]; ok {
			spec.Env = append(spec.Env, "MODEL="+mid)
		}
	}
	id, err := sandbox.Create(ctx, spec)
	if err != nil {
		return err
	}
	defer sandbox.Remove(id)
	if err := sandbox.CopyIn(ctx, id, "/agent", bundle, 0); err != nil {
		return err
	}
	work := map[string]sandbox.File{}
	for n, b := range task.Workspace() {
		work[n] = sandbox.File{Body: b}
	}
	if err := sandbox.CopyIn(ctx, id, "/work", work, 0); err != nil {
		return err
	}

	// Stop the agent early on a cancel or once the budget is spent; meanwhile publish the log as it grows.
	out := &sandbox.Tail{Max: maxLog}
	stop := make(chan struct{})
	var stopReason string
	var stopMu sync.Mutex
	watchCtx, endWatch := context.WithCancel(ctx)
	go func() {
		t := time.NewTicker(pollEvery)
		defer t.Stop()
		for {
			select {
			case <-watchCtx.Done():
				return
			case <-t.C:
			}
			var status string
			var used, budget int64
			err := w.pool.Tx(watchCtx, func(ctx context.Context, tx pgx.Tx) error {
				if _, err := tx.Exec(ctx, `UPDATE runs SET agent_log = $2 WHERE id = $1 AND status = 'agent'`, c.id, sanitize.CleanLog(out.String(), maxLog)); err != nil {
					return err
				}
				return tx.QueryRow(ctx, `SELECT status, tokens_in + tokens_out + tokens_cache_write, token_budget FROM runs WHERE id = $1`, c.id).
					Scan(&status, &used, &budget)
			})
			if err != nil {
				continue
			}
			reason := ""
			if status != "agent" {
				reason = "cancelled"
			} else if used >= budget {
				reason = "budget"
			}
			if reason != "" {
				stopMu.Lock()
				stopReason = reason
				stopMu.Unlock()
				close(stop)
				return
			}
		}
	}()
	started := time.Now()
	res, err := sandbox.Start(ctx, id, c.timeLimit, stop, out)
	endWatch()
	if err != nil {
		return err
	}
	stopMu.Lock()
	reason := stopReason
	stopMu.Unlock()
	if reason == "cancelled" {
		return nil
	}
	exit := "ok"
	switch {
	case reason == "budget":
		exit = "budget"
	case res.TimedOut:
		exit = "timeout"
	case res.ExitCode != 0:
		exit = fmt.Sprintf("error:%d", res.ExitCode)
	}
	secs := int(math.Round(time.Since(started).Seconds()))
	_ = w.exec(ctx, `DELETE FROM gateway_tokens WHERE run_id = $1 AND purpose = 'agent'`, c.id)
	log.Info("agent finished", "exit", exit, "seconds", secs)

	image := ImageFor(c.id)
	if err := sandbox.Commit(ctx, id, image, "ENV ANTHROPIC_API_KEY=", "ENV OPENAI_API_KEY=", "ENV GEMINI_API_KEY=", `CMD ["sh"]`); err != nil {
		return fmt.Errorf("snapshot: %w", err)
	}
	return w.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE runs SET status = 'checking', agent_exit = $2, agent_seconds = $3, image = $4, agent_log = $5, updated_at = now()
			WHERE id = $1 AND status = 'agent'`, c.id, exit, secs, image, sanitize.CleanLog(res.Output, maxLog))
		return err
	})
}

// verifyResult is what verify.py writes to /verify/out/result.json.
type verifyResult struct {
	Start struct {
		OK      bool    `json:"ok"`
		Seconds float64 `json:"seconds"`
		Error   string  `json:"error"`
	} `json:"start"`
	Checks        []Check `json:"checks"`
	ConsoleErrors int     `json:"console_errors"`
	HiddenFrom    float64 `json:"hidden_from"` // unix time the hidden checks started (0 = none ran)
}

// check measures the code, then runs the app and verify.py side by side: the app in its own container from the
// snapshot, verify.py (checks, screenshots) in a clean runtime container that reaches the app over the sandbox
// network. Nothing the agent wrote runs in the checker's container, so it can't touch the checker or its result.
func (w *Worker) check(ctx context.Context, c claimed, log *slog.Logger) error {
	if !w.stillActive(ctx, c.id, "checking") {
		return nil
	}
	stop, endWatch := w.watchStatus(ctx, c.id, "checking")
	defer endWatch()
	task := tasks.BySlug(c.task)
	image := ImageFor(c.id)
	hex := PreviewHost(c.id)
	labels := map[string]string{"arena.run": c.id, "arena.role": "check"}

	// The sources come out with docker cp from a container that never starts.
	snap, err := sandbox.Create(ctx, sandbox.Spec{Name: "arena-src-" + hex, Image: image, Labels: labels, Cmd: []string{"true"}})
	if err != nil {
		return err
	}
	var ws workspace
	err = sandbox.StreamOut(ctx, snap, "/work", func(r io.Reader) error {
		var err error
		ws, err = readSources(r)
		return err
	})
	sandbox.Remove(snap)
	if err != nil {
		return fmt.Errorf("read sources: %w", err)
	}
	stats, sourceZip, err := sourceStats(ws.files)
	if err != nil {
		return fmt.Errorf("count sources: %w", err)
	}

	appName := "arena-app-" + hex
	appID, startError := "", ""
	if !ws.topLevel["start.sh"] {
		startError = "no start.sh in /work"
	} else {
		if appID, err = sandbox.Create(ctx, sandbox.AppSpec(appName, image, c.network, labels)); err != nil {
			return err
		}
		defer sandbox.Remove(appID)
	}

	// The app starts first, before the checker is created: under gVisor the checker gets the app's address in
	// /etc/hosts at creation (sandbox.Create). verify.py times the start from this moment (one host clock).
	var appStart float64
	if appID != "" {
		if err := sandbox.StartDetached(ctx, appID); err != nil {
			return err
		}
		appStart = float64(time.Now().UnixMilli()) / 1000
	}
	id, err := sandbox.Create(ctx, sandbox.Spec{
		Name: "arena-check-" + hex, Image: sandbox.Image, Network: c.network,
		Memory: "2g", CPUs: "2", Pids: 4096, Workdir: "/verify", Labels: labels,
		Env: []string{"HOME=/root", "PYTHONDONTWRITEBYTECODE=1"},
		Cmd: []string{"python3", "/verify/verify.py"},
	})
	if err != nil {
		return err
	}
	defer sandbox.Remove(id)
	spec, err := json.Marshal(map[string]any{
		"task": c.task, "checks": task.AllChecks(), "ui": task.UI, "ui_text": task.UIText,
		"app_host": appName, "app_port": sandbox.AppPort, "app_started_at": appStart, "start_error": startError,
	})
	if err != nil {
		return err
	}
	if err := sandbox.CopyIn(ctx, id, "/verify", map[string]sandbox.File{
		"verify.py": {Body: verifyPy, Mode: 0o600}, "spec.json": {Body: spec, Mode: 0o600},
	}, 0o700); err != nil {
		return err
	}
	res, err := sandbox.Start(ctx, id, checkTimeout, stop, &sandbox.Tail{Max: maxLog})
	if err != nil {
		return err
	}
	if !w.stillActive(ctx, c.id, "checking") {
		return nil
	}
	outTar, err := sandbox.CopyOut(ctx, id, "/verify/out", verifyOutMax)
	if err != nil {
		return fmt.Errorf("check output: %w (exit %d, timed out %v): %s", err, res.ExitCode, res.TimedOut, tailStr(res.Output, 800))
	}
	files := untar(outTar)
	var vr verifyResult
	if err := json.Unmarshal(files["result.json"], &vr); err != nil {
		return fmt.Errorf("check result: %v (exit %d): %s", err, res.ExitCode, tailStr(res.Output, 800))
	}
	checkLog := res.Output
	if appID != "" {
		if running, code, err := sandbox.State(ctx, appID); err == nil && !running && !vr.Start.OK {
			vr.Start.Error = fmt.Sprintf("start.sh exited with code %d", code)
		}
		// The app's own output stops where the hidden checks start: an app could log the requests they make.
		checkLog += "\n--- app output ---\n" + sandbox.Logs(ctx, appID, maxLog/2, vr.HiddenFrom)
	}
	shot, shotMobile := files["shot.jpg"], files["shot-mobile.jpg"]
	if len(shot) > maxShot {
		shot = nil
	}
	if len(shotMobile) > maxShot {
		shotMobile = nil
	}
	stats.StartSeconds = vr.Start.Seconds
	stats.ConsoleErrors = vr.ConsoleErrors
	checks := append([]Check{{Name: tasks.CheckStart, Passed: vr.Start.OK, Detail: vr.Start.Error}}, vr.Checks...)
	score := Score(checks, vr.Start.OK)
	statsJSON, _ := json.Marshal(stats)
	checksJSON, _ := json.Marshal(checks)
	log.Info("run checked", "score", score, "loc", stats.LOC)
	return w.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE runs SET status = 'done', recheck = false, stats = $2, checks = $3, score = $4, app_started = $5,
			shot = $6, shot_mobile = $7, source_zip = $8, check_log = $9, finished_at = now(), updated_at = now()
			WHERE id = $1 AND status = 'checking'`,
			c.id, statsJSON, checksJSON, score, vr.Start.OK, shot, shotMobile, sourceZip, sanitize.CleanLog(checkLog, maxLog))
		return err
	})
}

// watchStatus returns a channel that closes once the run leaves status (a cancel), and a func to stop watching.
func (w *Worker) watchStatus(ctx context.Context, id, status string) (<-chan struct{}, func()) {
	stop := make(chan struct{})
	wctx, cancel := context.WithCancel(ctx)
	go func() {
		t := time.NewTicker(pollEvery)
		defer t.Stop()
		for {
			select {
			case <-wctx.Done():
				return
			case <-t.C:
			}
			if !w.stillActive(wctx, id, status) {
				close(stop)
				return
			}
		}
	}()
	return stop, cancel
}

// Score is the share of automatic checks passed, 0..100; 0 when the app doesn't start.
func Score(checks []Check, started bool) int {
	if !started {
		return 0
	}
	passed := 0
	for _, c := range checks {
		if c.Passed {
			passed++
		}
	}
	return int(math.Round(100 * float64(passed) / float64(max(1, len(checks)))))
}

func untar(b []byte) map[string][]byte {
	out := map[string][]byte{}
	tr := tar.NewReader(bytes.NewReader(b))
	for {
		h, err := tr.Next()
		if err != nil {
			return out
		}
		if h.Typeflag != tar.TypeReg {
			continue
		}
		body, err := io.ReadAll(io.LimitReader(tr, verifyOutMax))
		if err != nil {
			return out
		}
		name := h.Name
		if i := strings.LastIndex(name, "/"); i >= 0 {
			name = name[i+1:]
		}
		out[name] = body
	}
}

func tailStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}
