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
    judge_tokens_in    bigint NOT NULL DEFAULT 0,
    judge_tokens_out   bigint NOT NULL DEFAULT 0,
    agent_seconds      int,
    image              text,
    stats              jsonb NOT NULL DEFAULT '{}'::jsonb,
    checks             jsonb NOT NULL DEFAULT '[]'::jsonb,
    judge              jsonb,
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
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX runs_open_idx ON runs (created_at) WHERE status IN ('queued', 'agent', 'checking');
CREATE INDEX runs_task_idx ON runs (task, score DESC NULLS LAST);

-- Short-lived credentials the sandboxed agent (or judge) sends to the gateway instead of a real key.
CREATE TABLE gateway_tokens (
    token_hash text PRIMARY KEY,
    run_id     text NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    purpose    text NOT NULL CHECK (purpose IN ('agent', 'judge')),
    expires_at timestamptz NOT NULL
);
CREATE INDEX gateway_tokens_run_idx ON gateway_tokens (run_id);

-- Platform switches the admin page flips (internal/admin): exactly one row.
CREATE TABLE settings (
    id          boolean PRIMARY KEY DEFAULT true CHECK (id),
    runs_paused boolean NOT NULL DEFAULT false, -- the worker takes no queued runs
    user_runs   boolean NOT NULL DEFAULT true,  -- non-admins may upload agents and start runs
    judge       boolean NOT NULL DEFAULT true,  -- runs are judged (it spends the platform's judge key)
    updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings DEFAULT VALUES;

GRANT USAGE ON SCHEMA public TO arena_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, user_identities, sessions, agents, runs, gateway_tokens, settings TO arena_app;

