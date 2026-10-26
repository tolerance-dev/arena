package runs

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// queueOrder lists the queued runs (id, created_at, turn, served) in the order the worker takes them: round-robin
// between owners. A run's turn is its place among its owner's queued runs plus the owner's runs already running, so
// one user's pile waits behind everyone else's first run and can't take every slot. Equal turns go first to the
// owner served longest ago (or never: served is their last run's start), then to the older run.
const queueOrder = `SELECT q.id, q.created_at, q.turn, q.served FROM (
		SELECT r.id, r.created_at,
			row_number() OVER (PARTITION BY a.owner_id ORDER BY r.created_at)
				+ (SELECT count(*) FROM runs r2 JOIN agents a2 ON a2.id = r2.agent_id
					WHERE a2.owner_id = a.owner_id AND r2.status IN ('agent', 'checking')) AS turn,
			(SELECT max(r3.started_at) FROM runs r3 JOIN agents a3 ON a3.id = r3.agent_id WHERE a3.owner_id = a.owner_id) AS served
		FROM runs r JOIN agents a ON a.id = r.agent_id WHERE r.status = 'queued'
	) q ORDER BY ` + queueSort

// queueSort orders queueOrder's rows; repeat it on any query that wraps queueOrder.
const queueSort = `turn, served NULLS FIRST, created_at, id`

// queueLock serializes claims: queueOrder can't lock rows (it has window functions), so two slots taking the head
// at once would race.
const queueLock = 7_301_001

// queueSpot is where a queued run stands: its place (1 = next) and an estimated wait.
type queueSpot struct {
	position int
	waitS    *int // nil while the queue is paused
}

// recentRunDuration is how long a run takes from claim to verdict, averaged over the last finished ones; the task's
// time limit stands in until there are some.
func recentRunDuration(ctx context.Context, tx pgx.Tx) (time.Duration, error) {
	var s *float64
	err := tx.QueryRow(ctx, `SELECT avg(extract(epoch FROM finished_at - started_at)) FROM (
			SELECT finished_at, started_at FROM runs WHERE status = 'done' AND started_at IS NOT NULL
			ORDER BY finished_at DESC LIMIT 20) x`).Scan(&s)
	if err != nil || s == nil {
		return 20 * time.Minute, err
	}
	return time.Duration(*s * float64(time.Second)), nil
}

// queueSpots places every queued run. The wait plays the queue out on `slots` workers: each running run frees its
// slot after the average duration (at least a minute from now), each queued run then takes the earliest free slot.
func queueSpots(ctx context.Context, tx pgx.Tx, slots int) (map[string]queueSpot, error) {
	out := map[string]queueSpot{}
	var paused bool
	if err := tx.QueryRow(ctx, `SELECT coalesce((SELECT runs_paused FROM settings), false)`).Scan(&paused); err != nil {
		return nil, err
	}
	avg, err := recentRunDuration(ctx, tx)
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `SELECT started_at FROM runs WHERE status IN ('agent', 'checking') AND started_at IS NOT NULL`)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	var free []time.Duration // when each slot frees up, from now
	for rows.Next() {
		var started time.Time
		if err := rows.Scan(&started); err != nil {
			rows.Close()
			return nil, err
		}
		free = append(free, max(time.Minute, avg-now.Sub(started)))
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for len(free) < max(1, slots) {
		free = append(free, 0)
	}
	rows, err = tx.Query(ctx, queueOrder)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for i := 1; rows.Next(); i++ {
		var id string
		var created time.Time
		var turn int64
		var served *time.Time
		if err := rows.Scan(&id, &created, &turn, &served); err != nil {
			return nil, err
		}
		spot := queueSpot{position: i}
		if !paused {
			k := 0
			for j := range free {
				if free[j] < free[k] {
					k = j
				}
			}
			w := int(free[k].Seconds())
			spot.waitS = &w
			free[k] += avg
		}
		out[id] = spot
	}
	return out, rows.Err()
}

// placeQueued fills the queue position and wait of the queued runs among rs.
func (s *Service) placeQueued(ctx context.Context, tx pgx.Tx, rs []Run) error {
	queued := false
	for _, r := range rs {
		queued = queued || r.Status == "queued"
	}
	if !queued {
		return nil
	}
	spots, err := queueSpots(ctx, tx, s.Slots)
	if err != nil {
		return err
	}
	for i := range rs {
		if sp, ok := spots[rs[i].ID]; ok {
			p := sp.position
			rs[i].QueuePosition, rs[i].QueueWaitS = &p, sp.waitS
		}
	}
	return nil
}
