-- +goose Up

-- Agent runs (since 2026-10-19): an uploaded agent builds a whole app (backend + frontend) for a task inside the
-- platform's sandbox; the platform then checks it and a judge model scores it. The older tables (daily, tanks,
-- builds) are left in place, unused.

-- An uploaded agent: a zip with run.sh at its root, plus the LLM key it spends. The key is sealed with
-- ARENA_SECRET_KEY (internal/platform/secretbox) and only the gateway ever opens it.
CREATE TABLE agents (
    id           text PRIMARY KEY,
    owner_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name         text NOT NULL,
    description  text NOT NULL DEFAULT '',
    bundle       bytea NOT NULL,
    bundle_files int NOT NULL DEFAULT 0,
    provider     text NOT NULL CHECK (provider IN ('anthropic', 'openai')),
    api_key      bytea NOT NULL,
    key_hint     text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One attempt of an agent at a task. status: queued → agent (building) → checking → done; infra_error when the
-- platform failed. How the agent itself ended is agent_exit (ok | timeout | budget | error).
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

GRANT SELECT, INSERT, UPDATE, DELETE ON agents, runs, gateway_tokens TO arena_app;

-- +goose Down
DROP TABLE gateway_tokens;
DROP TABLE runs;
DROP TABLE agents;
