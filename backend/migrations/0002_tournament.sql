-- The weekly tournament (internal/runs/tournament.go). IF NOT EXISTS: dev databases made from schema.sql before
-- migrations began may already have it.

-- A tournament: every ready agent of the site owner at every task, a few runs each, queued at once. week is the
-- ISO week ('2026-W44') of a scheduled one, unique so that only one worker queues it; NULL when the owner started it
-- by hand.
CREATE TABLE IF NOT EXISTS tournaments (
    id         text PRIMARY KEY,
    week       text UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- The tournament that queued the run.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS tournament_id text REFERENCES tournaments (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS runs_tournament_idx ON runs (tournament_id) WHERE tournament_id IS NOT NULL;

-- The weekly tournament is on since then (NULL = off): a week counts only if its start falls after it.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tournament_since timestamptz;

GRANT SELECT, INSERT, UPDATE, DELETE ON tournaments TO arena_app;
