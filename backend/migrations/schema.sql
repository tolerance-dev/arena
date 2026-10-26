-- The whole schema, applied by cmd/migrate to an empty database. There is no data worth keeping yet: change this
-- file freely and recreate the database (make reset locally, reset_db=true on prod) instead of adding migrations.

CREATE TABLE users (
    id         text PRIMARY KEY,
    email      text NOT NULL UNIQUE,
    handle     text NOT NULL UNIQUE,
    role       text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    -- blocked: an admin took away uploads and runs (internal/admin).
    blocked    boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_handle_lower_idx ON users (lower(handle));

-- One row per external account (GitHub or Google).
CREATE TABLE user_identities (
    provider      text NOT NULL CHECK (provider IN ('github', 'google')),
    subject       text NOT NULL,
    user_id       text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    email         text NOT NULL,
    login         text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);
CREATE INDEX user_identities_user_idx ON user_identities (user_id);

-- id is the hash of the cookie token.
CREATE TABLE sessions (
    id           text PRIMARY KEY,
    user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- An uploaded agent: a zip with run.sh at its root, plus the LLM key it spends. The key is sealed with
-- ARENA_SECRET_KEY (internal/platform/secretbox) and only the gateway ever opens it.
CREATE TABLE agents (
    id           text PRIMARY KEY,
    owner_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name         text NOT NULL,
    description  text NOT NULL DEFAULT '',
    bundle       bytea NOT NULL,
    bundle_files int NOT NULL DEFAULT 0,
    provider     text NOT NULL CHECK (provider IN ('anthropic', 'openai', 'google', 'orcarouter', 'claude-sub', 'chatgpt-sub')),
    api_key      bytea NOT NULL,
    key_hint     text NOT NULL DEFAULT '',
    -- model: a ready agent's model (internal/pricing slug), '' for an uploaded one. The worker sets MODEL by it.
    model        text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One attempt of an agent at a task. status: queued → agent (building) → checking → done; infra_error when the
-- platform failed. How the agent itself ended is agent_exit (ok | timeout | budget | error:N).
CREATE TABLE runs (
    id                 text PRIMARY KEY,
    agent_id           text NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
    task               text NOT NULL,
    status             text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'agent', 'checking', 'done', 'infra_error')),
    failure_reason     text,
    agent_exit         text,
    time_limit_s       int NOT NULL,
    token_budget       bigint NOT NULL,
    tokens_in          bigint NOT NULL DEFAULT 0,
    tokens_out         bigint NOT NULL DEFAULT 0,
    tokens_cache_read  bigint NOT NULL DEFAULT 0,
    tokens_cache_write bigint NOT NULL DEFAULT 0,
    llm_requests       int NOT NULL DEFAULT 0,
    agent_seconds      int,
    image              text,
    recheck            boolean NOT NULL DEFAULT false, -- queued again to check its snapshot only (runs.Service.Recheck)
    rechecks           int NOT NULL DEFAULT 0,         -- how many times the snapshot was checked again
    stats              jsonb NOT NULL DEFAULT '{}'::jsonb,
    checks             jsonb NOT NULL DEFAULT '[]'::jsonb,
    score              int,
    app_started        boolean NOT NULL DEFAULT false,
    shot               bytea,
    shot_mobile        bytea,
    source_zip         bytea,
    agent_log          text NOT NULL DEFAULT '',
    check_log          text NOT NULL DEFAULT '',
    created_at         timestamptz NOT NULL DEFAULT now(),
    started_at         timestamptz,
    finished_at        timestamptz,
    updated_at         timestamptz NOT NULL DEFAULT now(),
    -- worker_id: the worker (workers.id) that claimed the run; it alone touches the run's containers.
    worker_id          text
);
CREATE INDEX runs_open_idx ON runs (created_at) WHERE status IN ('queued', 'agent', 'checking');
CREATE INDEX runs_task_idx ON runs (task, score DESC NULLS LAST);

-- The daily run quota (runs.Create): one row per run a user started, kept when the run or its agent is deleted, so
-- deleting doesn't give the quota back. run_id has no foreign key on purpose. refunded: the worker ended the run
-- in infra_error (the platform's fault; a cancel isn't), so it doesn't count. arena_app may not delete rows;
-- they go only with the user (account deletion).
CREATE TABLE run_quota (
    run_id     text PRIMARY KEY,
    user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    refunded   boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX run_quota_user_idx ON run_quota (user_id, created_at);

-- Short-lived credentials the sandboxed agent sends to the gateway instead of a real key.
CREATE TABLE gateway_tokens (
    token_hash text PRIMARY KEY,
    run_id     text NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    purpose    text NOT NULL CHECK (purpose = 'agent'),
    expires_at timestamptz NOT NULL
);
CREATE INDEX gateway_tokens_run_idx ON gateway_tokens (run_id);

-- A person's blind pick between two agents' apps at one task (internal/runs/votes.go); the agents' Elo comes from
-- these. The pair is stored in id order (run_a < run_b), so one person votes on a pair once.
CREATE TABLE pair_votes (
    user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    task       text NOT NULL,
    run_a      text NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    run_b      text NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    winner     text NOT NULL CHECK (winner IN ('a', 'b', 'tie')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, run_a, run_b),
    CHECK (run_a < run_b)
);

-- A pair handed to a voter (runs.NextPair). The page only gets the pair's id and an alias per side: the shots and the
-- live previews are served by alias, so the run ids (and through them the agents) stay hidden until the vote.
CREATE TABLE vote_pairs (
    id         text PRIMARY KEY,
    user_id    text REFERENCES users (id) ON DELETE CASCADE, -- NULL: handed to a guest, whoever signs in and votes on it
    task       text NOT NULL,
    run_a      text NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    run_b      text NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    alias_a    text NOT NULL UNIQUE,
    alias_b    text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vote_pairs_created ON vote_pairs (created_at);
CREATE INDEX pair_votes_task_idx ON pair_votes (task, created_at);

-- Platform switches the admin page flips (internal/admin): exactly one row.
CREATE TABLE settings (
    id          boolean PRIMARY KEY DEFAULT true CHECK (id),
    runs_paused boolean NOT NULL DEFAULT false, -- the worker takes no queued runs
    user_runs   boolean NOT NULL DEFAULT true,  -- non-admins may upload agents and start runs
    updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings DEFAULT VALUES;

-- Live run workers (cmd/worker), each beating every few seconds. A run in flight whose worker stopped beating is
-- lost: another worker (or the next one to start) marks it infra_error and removes its containers.
CREATE TABLE workers (
    id           text PRIMARY KEY,
    host         text NOT NULL,
    started_at   timestamptz NOT NULL DEFAULT now(),
    heartbeat_at timestamptz NOT NULL DEFAULT now()
);

GRANT USAGE ON SCHEMA public TO arena_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, user_identities, sessions, agents, runs, gateway_tokens, pair_votes, vote_pairs, settings, workers TO arena_app;
GRANT SELECT, INSERT, UPDATE ON run_quota TO arena_app;

