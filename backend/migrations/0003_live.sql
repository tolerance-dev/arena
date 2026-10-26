-- The agent at work, as the site shows it live (internal/runs/live.go): the workspace's source files sampled every few
-- seconds while the agent runs, how they grew, and the app started from the workspace now and then.

-- One row per run that reached the agent. files: [{path, lines, bytes, added_s, changed_s}] (seconds since the agent
-- started); series: [{t, files, loc, tokens}]. preview is the last app the worker started (arena-live-<hex>-<n>),
-- preview_ready the last one the gateway saw answering (0 = none yet). watched_at: someone has the run page open,
-- so starting apps is worth it.
CREATE TABLE IF NOT EXISTS run_live (
    run_id        text PRIMARY KEY REFERENCES runs (id) ON DELETE CASCADE,
    files         jsonb NOT NULL DEFAULT '[]',
    series        jsonb NOT NULL DEFAULT '[]',
    preview       int NOT NULL DEFAULT 0,
    preview_ready int NOT NULL DEFAULT 0,
    watched_at    timestamptz,
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- The latest body of each source file in run_live.files (text files under a size cap only).
CREATE TABLE IF NOT EXISTS run_live_files (
    run_id     text NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    path       text NOT NULL,
    body       text NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, path)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON run_live, run_live_files TO arena_app;
