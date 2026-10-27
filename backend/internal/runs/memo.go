package runs

import (
	"sync"
	"time"
)

// memo keeps the public reads everyone asks for the same answer to (the standings, the vote ratings, the feeds) for
// a few seconds: a page polls them every 8–15 s from every open tab, and each answer replays a task's leaderboards
// or votes. Concurrent misses on one key wait for one load instead of each running it. Errors aren't kept. Values
// are shared between requests: callers don't change them. Keys come from query strings, so past memoMax of them the
// map starts over rather than grow without end.
type memo struct {
	mu sync.Mutex
	m  map[string]*memoEntry
}

const memoMax = 1000

type memoEntry struct {
	mu sync.Mutex
	at time.Time
	v  any
}

func memoize[T any](c *memo, key string, ttl time.Duration, load func() (T, error)) (T, error) {
	c.mu.Lock()
	if c.m == nil || len(c.m) >= memoMax {
		c.m = map[string]*memoEntry{}
	}
	e := c.m[key]
	if e == nil {
		e = &memoEntry{}
		c.m[key] = e
	}
	c.mu.Unlock()
	e.mu.Lock()
	defer e.mu.Unlock()
	if v, ok := e.v.(T); ok && time.Since(e.at) < ttl {
		return v, nil
	}
	v, err := load()
	if err == nil {
		e.v, e.at = v, time.Now()
	}
	return v, err
}
