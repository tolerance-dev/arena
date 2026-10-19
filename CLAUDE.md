# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Prototype mode (since 2026-10-03) — read first

The product concept is still changing week to week (tasks, judging, scoring
may all be redone). The goal is a working skeleton, fast. This section
overrides the superpowers skills and any default habits:

- **Write code directly.** No brainstorming sessions, no specs or task-by-task
  plans in `docs/`, no subagent-driven-development, no TDD, no per-task or
  whole-branch reviews — unless the user asks for one. If a change needs a
  plan, a short list of steps in chat is enough.
- **No new tests.** Since the 2026-10-19 pivot almost no tests remain; add one only for a bug in the gateway's
  token metering or the run verdict (`internal/gateway`, `internal/runs`).
- **"Done" = it compiles and works locally**: `make test-fast`, then `make dev`
  (or `make up`) and the flow clicked through. Full `make test` is optional.
  CI (`ci.yml`) is manual-only (`workflow_dispatch`); nothing runs on push.
- **Throwing code away is fine.** When the concept changes, delete the old
  feature (code, routes, pages, tests) rather than keeping it compatible.
- **No ops work** unless asked. Deploy is one button: Actions → deploy → Run
  workflow (`gh workflow run deploy`; `ref` = older sha to roll back). It
  builds the images into GHCR and runs `deploy/server.sh` on the host over SSH
  (secrets in the `production` environment). `deploy/compose.yml` and
  `deploy/Caddyfile` are the server's source of truth — the Caddyfile also
  serves `mentor.nualimov.dev`, keep that block.
  The old canary/monitoring stack is at git tag `ops-snapshot-2026-10-03`.
- **Docs**: `README.md` is a short pitch + how to run; there are no specs. Update this file only with what
  would trip up the next session.
- **Git: only through pull requests.** Pushing to `main` is blocked on GitHub (branch protection,
  admins included, since 2026-10-19). Work on a branch (`git fetch && git checkout -b <name> origin/main`),
  push it, open a PR with `gh pr create` and stop there: **never merge a PR yourself** (no `gh pr merge`,
  no auto-merge) — the user reviews and merges. Give the PR link in the reply. Never try to push to `main` or
  weaken the protection.

## What this is

**tolerance** (site https://tolerance.cc; env vars are `ARENA_*`, the database is `arena`). Since 2026-10-19 it
is an **agent arena for whole apps**: an admin uploads an agent (a `run.sh` or a zip with `run.sh`) plus its LLM
key; a run puts the agent in a sandbox with a task (`TASK.md` + shared mock data); the agent writes backend and
frontend; the platform measures and judges the result. Everything older (daily task, tanks, build challenges,
products, profiles, fair play, …) was deleted, code and tables; it is in git history (before "Pivot to agent
runs").

Run lifecycle (`internal/runs/worker.go`), status `queued → agent → checking → done | infra_error`:
1. **agent**: container from `arena-runtime:1` on the internal Docker network `arena-agents` (no route out).
   `/agent` = the bundle, `/work` = `TASK.md` + `data/`. Env: `ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL` = the gateway,
   `*_API_KEY` = a per-run token (`gateway_tokens`), npm/PyPI mirrors, `ARENA_DEADLINE`, `ARENA_TOKEN_BUDGET`.
   Killed on time limit, on budget (polled every 3 s) or on cancel. Then `docker commit` → image
   `arena-run:<hex>` (the snapshot; previews and checks start from it).
2. **checking**: source tar out of the snapshot → LOC per language + `source_zip`; then a check container runs
   `internal/runs/verify.py` as root, which starts `/work/start.sh` as uid 1001 (so the app can't read `/verify`
   with the judge checklist and token), runs the task's HTTP checks (`task.json`), screenshots desktop/mobile, and
   runs the judge (Anthropic SDK through the gateway with a judge token; tools: browser via Playwright, HTTP,
   read files; ends with `submit_verdict`).
3. **score** = 0 if the app didn't start, else 30% automatic checks + 70% judge (checks only when no judge).
   Since 2026-10-19 (second half) the tasks have no `judge.md` → no judge (`judge.status = "off"`), and no `"ui"`
   in `task.json` → no HTML check, screenshots or live preview. The judge code stays for later.

`cmd/gateway` (always a container, on `default` + `arena-agents` with alias `gateway`): `/anthropic/*`,
`/openai/*` swap the run token for the real key (agent keys are sealed with `ARENA_SECRET_KEY`, the judge key is
`ARENA_JUDGE_API_KEY` on the gateway only), meter usage from JSON/SSE into `runs.tokens_*`, enforce budget;
`/npm/*`, `/pypi/*`, `/pyfiles/*` are read-only registry mirrors. Port 8091 serves live previews:
`http://<run-hex>.preview.localhost:$GATEWAY_PORT` starts `arena-preview-<hex>` from the snapshot on demand.
`ARENA_GATEWAY_FAKE=true` answers LLM calls locally (fake judge included) to click through without keys.

Tasks (now simple, API-only: `rbtree`, `linked-list`, `digraph`): `backend/internal/tasks/catalog/<slug>/`
(`TASK.md`, optional `judge.md`, and `task.json` + `data/*.json` GENERATED by `internal/tasks/gen_data.py` from
reference implementations, so edit checks there and rerun it) + `catalog/RULES.md` appended to every brief.
`verify.py` has an `"rbtree": true` expectation that validates the red-black invariants of a returned tree.
`judge.md` can be overridden from `ARENA_TASKS_HIDDEN_DIR/<slug>/judge.md`. Example agents:
`examples/agents/{claude-code,demo}`; `demo` is a reference solution that passes every check.

Prod (`deploy/`) is NOT adapted yet: it has no gateway service, no `arena-runtime` image, no
`arena-agents` network and no `*.preview` DNS/TLS. Don't press deploy until that is done.

Monorepo: `backend/` (Go module `tolerance`) and `frontend/` (Next.js, talks to the backend over HTTP only).

## Commands

```sh
make dev         # postgres + gateway in Docker, migrate, then api and web natively (Ctrl-C stops api/web)
make up          # whole stack in Docker
make down        # make reset also wipes the DB volume
make images      # arena-runtime:1 (sandbox image), built only when missing
make gateway     # rebuild + restart the gateway container (after Go changes in internal/gateway)
make test-fast   # gofmt + go vet + go test + pnpm typecheck
```

Ports come from `.env` (`WEB_PORT`, `API_PORT`, `PG_PORT`, `GATEWAY_PORT`). Admins (upload agents, start runs) are
`ownerEmail` = alimov.nsm@gmail.com (in `cmd/api/config.go`) + `ARENA_ADMIN_EMAILS`, locally too: the dev login does
NOT make everyone an admin; dev-sign in as the owner to upload. Others see `/admin` disabled ("In development").

## Map

```
backend/cmd/api            config, handler.go (ALL routing), main (server + runs worker)
backend/cmd/gateway        LLM/registry proxy + live previews
backend/cmd/migrate        goose up
backend/internal/agents    agent bundles + sealed keys, admin upload routes
backend/internal/runs      runs service/routes, worker, verify.py (checks + judge), LOC stats
backend/internal/gateway   gateway.go (proxy, metering, budget, fake upstream), preview.go
backend/internal/sandbox   docker CLI wrapper (create/cp/start/commit), network arena-agents
backend/internal/tasks     task catalog (embedded)
backend/runtime            Dockerfile of arena-runtime:1 (Playwright python + Node 22 + claude/codex CLIs)
frontend/app               / (tasks), /t/[slug], /r/[id], /admin, /login
frontend/components/runs   the views
```

Public: `/api/v1/tasks*`, `/runs*`, `/agents*`. Session + admin: `/api/v1/admin/*` (agents, runs). `/me` needs a
session.

## Rules that stay even in prototype mode

- **Sandbox safety**: agent/check/preview containers run with dropped caps on the internal `arena-agents`
  network; the real LLM keys never enter a sandbox; the app under check runs as uid 1001, away from `/verify`.
- `infra_error` is the platform's fault, never a score.
- **Database: no data worth keeping yet** (prod included). The schema is `migrations/00002_schema.sql`
  (+ `00001`, the arena_app role): edit it in place and recreate the DB (`make reset` locally, the same
  wipe on prod) instead of adding migrations or writing compatibility/cleanup code.
- Agent-written logs are sanitized server-side (`internal/platform/sanitize`).
- Run snapshots (`arena-run:*` images) older than a day are removed hourly by the worker, except each agent's
  best run per task.
- Errors go through `httpx.WriteError` (`{code, message, request_id}`);
  timestamps are UTC (`.UTC()` after scanning — pgx returns local time).
- Frontend: no mocks, data from the API, browser calls same-origin `/api/v1/*`.
- UI copy is bilingual (en, ru): strings live in `frontend/lib/i18n/messages/<area>.ts`
  (`defineMessages`, ru must have every en key), read with `useT(m)` in client
  components or `await getT(m)` on the server; dates via `formatDate`/
  `formatDateTime` from `lib/i18n/core`. Language = `lang` cookie, else
  Accept-Language, else en. Task content (TASK.md, judge.md) stays English.
- Colours are tokens from `frontend/app/globals.css`, never raw hex in classes:
  `bg-terminal`/`text-terminal-foreground` for copy blocks and dark panels (navy
  in both themes), `bg-arena` for the match viewer, `border-input` for control
  borders (3:1), `border-strong` for dashed empty states.
- Commit subjects in English, imperative, sentence case, no `feat:` prefixes.
  README is in Russian, code and comments in English.
