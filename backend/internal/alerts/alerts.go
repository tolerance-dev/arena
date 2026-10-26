// Package alerts watches the platform for trouble an operator should hear about before users do: the disk filling
// up with run snapshots, runs failing on the platform's side, a queue that stopped moving. Each alert goes to the
// log and, when ARENA_ALERT_TELEGRAM_TOKEN and ARENA_ALERT_TELEGRAM_CHAT are set, to that Telegram chat; one kind is
// repeated at most once an hour while it lasts.
package alerts

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"

	"tolerance/internal/platform/db"
)

const (
	every     = 5 * time.Minute
	repeat    = time.Hour
	diskFree  = 0.15             // alert below this share of the disk free
	stuckWait = 30 * time.Minute // a queued run waiting this long with a slot free
	infraMin  = 3                // infra_errors in the last hour before it counts as a spike…
	infraRate = 0.5              // …and at least this share of the hour's finished runs
)

type Watcher struct {
	pool  *db.Pool
	log   *slog.Logger
	slots int
	send  func(ctx context.Context, text string) error // nil = log only
	last  map[string]time.Time
}

// New watches with slots = the worker's concurrency (a queued run with a free slot should start).
func New(pool *db.Pool, log *slog.Logger, slots int) *Watcher {
	w := &Watcher{pool: pool, log: log.With("component", "alerts"), slots: slots, last: map[string]time.Time{}}
	if token, chat := os.Getenv("ARENA_ALERT_TELEGRAM_TOKEN"), os.Getenv("ARENA_ALERT_TELEGRAM_CHAT"); token != "" && chat != "" {
		w.send = telegram(token, chat)
	}
	return w
}

func (w *Watcher) Run(ctx context.Context) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		w.check(ctx)
	}
}

func (w *Watcher) check(ctx context.Context) {
	// The api container's / is an overlay on Docker's data disk, where the snapshots live.
	var st syscall.Statfs_t
	if err := syscall.Statfs("/", &st); err == nil && st.Blocks > 0 {
		if free := float64(st.Bavail) / float64(st.Blocks); free < diskFree {
			w.alert(ctx, "disk", fmt.Sprintf("Disk %.0f%% free (%.1f GB). Old run snapshots are pruned hourly; look at `docker system df`.",
				100*free, float64(st.Bavail)*float64(st.Bsize)/1e9))
		}
	}
	var infra, finished, waiting, running int
	var oldest *time.Time
	var paused bool
	err := w.pool.Tx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT
				count(*) FILTER (WHERE status = 'infra_error' AND failure_reason IS DISTINCT FROM 'cancelled'),
				count(*)
			FROM runs WHERE finished_at > now() - interval '1 hour'`).Scan(&infra, &finished); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status = 'queued'), count(*) FILTER (WHERE status IN ('agent', 'checking')),
				min(created_at) FILTER (WHERE status = 'queued')
			FROM runs WHERE status IN ('queued', 'agent', 'checking')`).Scan(&waiting, &running, &oldest); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT runs_paused FROM settings`).Scan(&paused)
	})
	if err != nil {
		w.log.Warn("alert check", "err", err)
		return
	}
	if infra >= infraMin && float64(infra) >= infraRate*float64(finished) {
		w.alert(ctx, "infra", fmt.Sprintf("%d of %d runs in the last hour ended in infra_error (the platform's fault). See /admin and the api logs.", infra, finished))
	}
	if !paused && waiting > 0 && running < w.slots && oldest != nil && time.Since(*oldest) > stuckWait {
		w.alert(ctx, "queue", fmt.Sprintf("The queue isn't moving: %d queued, the oldest for %s, %d of %d slots busy.",
			waiting, time.Since(*oldest).Round(time.Minute), running, w.slots))
	}
}

func (w *Watcher) alert(ctx context.Context, kind, text string) {
	if t, ok := w.last[kind]; ok && time.Since(t) < repeat {
		return
	}
	w.last[kind] = time.Now()
	w.log.Warn("alert", "kind", kind, "text", text)
	if w.send != nil {
		if err := w.send(ctx, "tolerance: "+text); err != nil {
			w.log.Error("send alert", "err", err)
		}
	}
}

func telegram(token, chat string) func(ctx context.Context, text string) error {
	endpoint := "https://api.telegram.org/bot" + token + "/sendMessage"
	client := &http.Client{Timeout: 10 * time.Second}
	return func(ctx context.Context, text string) error {
		form := url.Values{"chat_id": {chat}, "text": {text}}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		resp, err := client.Do(req)
		if err != nil {
			// The error text carries the URL, and with it the bot token: keep it out of the log.
			return fmt.Errorf("telegram unreachable")
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("telegram answered %d", resp.StatusCode)
		}
		return nil
	}
}
