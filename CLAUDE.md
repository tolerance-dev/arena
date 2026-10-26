# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Prototype mode — read first

The product concept is still changing week to week (tasks, judging, scoring may all be redone). The goal is a
working skeleton, fast. This section overrides any skills and default habits:

- **Write code directly.** No brainstorming sessions, no specs or task-by-task plans in `docs/`, no
  subagent-driven-development, no TDD, no per-task or whole-branch reviews — unless the user asks for one. If a
  change needs a plan, a short list of steps in chat is enough.
- **No new tests**, except for a bug in the gateway's token metering or the run score (`internal/gateway`,
  `internal/runs`).
- **"Done" = it compiles and works locally**: `make test-fast`, then `make dev` (or `make up`) and the flow
  clicked through. Full `make test` is optional. CI (`ci.yml`: test-fast + `pnpm build`) runs on every PR; nothing runs on push.
- **Design: Product Hunt's layout, our tokens.** Pages follow producthunt.com (measurements in `DESIGN_REFERENCE.md`):
  a 900px main column + 280px aside (`components/ui/columns.tsx`; the aside drops below at <1280px), feed rows with
  52px counters (`components/ui/feed.tsx`), pill tabs, pill buttons. Colours, type scale and radii are the tokens in
  `globals.css`. Show only real data: no upvotes, categories or search until the backend has them, and an empty state
  instead of placeholders. Don't pile on blocks that repeat another page.
- **Throwing code away is fine.** When the concept changes, delete the old feature (code, routes, pages, tests)
  rather than keeping it compatible.
- **No deploys or prod work by you** (the user revoked the earlier permission on 2026-10-26): never run
  `gh workflow run deploy` or touch the server or Cloudflare. When a change needs a deploy, say so in the reply with
  the exact command for the user (`gh workflow run deploy`; `-f ref=<sha>` rolls back, `-f reset_db=true` wipes the
  DB — needed after any schema change). A hand change on the server that must survive goes into `deploy/` (server
  details: `deploy/README.md`).
- **Docs**: `README.md` is a short pitch + how to run; there are no specs. Update this file only with what would
  trip up the next session.
- **Git: through pull requests, merged by you.** Pushing to `main` is blocked (branch protection, admins
  included). Work on a branch (`git fetch && git checkout -b <name> origin/main`), push it, open a PR with
  `gh pr create`, then merge it yourself with `gh pr merge --squash` (allowed again by the user on 2026-10-26) once
  it is clean against fresh `main`, `make test-fast` passes and CI is green (`gh pr checks --watch`); resolve
  conflicts on the PR branch first. Give the PR link in the reply. Deploys stay with the user (above). Never push to
  `main` directly or weaken the protection.

## What this is

**tolerance** (https://tolerance.cc; env vars are `ARENA_*`, the database is `arena`): an **agent arena for whole
apps**. A user uploads an agent (a `run.sh` or a zip with `run.sh`) plus its LLM key; a run puts the agent in a
sandbox with a task (`TASK.md` + shared mock data); the agent writes backend and frontend; the platform measures
and checks the result, and people compare the apps in blind votes. **There is no LLM judge** (removed for cost: a
verdict cost dollars and wasn't reproducible); don't bring one back without the user asking. Older features were deleted; they are in git history (before "Pivot to agent runs").

Run lifecycle (`internal/runs/worker.go`), status `queued → agent → checking → done | infra_error`:
0. **queued**: the worker takes runs round-robin between owners (`queueOrder` in `internal/runs/queue.go`); the same
   order gives a queued run its `queue_position` and `queue_wait_s` in the API, so change them together.
1. **agent**: container from `arena-runtime:1` on the run's own internal Docker network `arena-run-<hex>` (no route
   out; only the gateway, which the worker attaches as `gateway`; the app and the checker reuse it later).
   `/agent` = the bundle, `/work` = `TASK.md` + `data/`. LLM base URLs point at the gateway, `*_API_KEY` is a
   per-run token (`gateway_tokens`). Killed on time limit, budget or cancel, then `docker commit` →
   `arena-run:<hex>` (the snapshot; previews and checks start from it).
2. **checking**: the sources come out of the snapshot with `docker cp` (nothing from it runs) → LOC, `source_zip`
   (nothing else). The app runs in its own container from the snapshot (`sandbox.AppSpec`, the same as a
   preview: 512 MB); `internal/runs/verify.py` runs in a clean `arena-runtime:1` container, pipes its
   127.0.0.1:3000 to the app's container, runs the checks and screenshots desktop/mobile. Never run platform code inside an agent's snapshot: the
   agent was root there and could have replaced python, tar or anything else.
3. **score** = the share of checks passed (the start check included), 0..100; 0 if the app didn't start
   (`runs.Score`).

`cmd/gateway` (a container labelled `arena.gateway=<stack>` on `default`, attached to every run and preview network): `/anthropic/*`, `/openai/*`, `/gemini/*`
(by protocol) swap the run token for the agent's real key (sealed with `ARENA_SECRET_KEY`), meter usage from JSON/SSE into `runs.tokens_*`, enforce budget. An
agent's provider (`anthropic`, `openai`, `google`, `orcarouter`; `gateway.providers`) says where each protocol goes;
OrcaRouter takes all three with one key (Gemini model names get its `google/` prefix in the gateway). Streamed chat
completions get `stream_options.include_usage` forced on, or they'd be unmetered.
Metering holes stay closed: the client's `Accept-Encoding` is dropped (a compressed stream can't be read; an
encoded response is refused), a stream is sniffed by its first bytes (chatgpt.com sends events with no
Content-Type) and WebSocket upgrades are refused (Codex's `responses_websocket` would tunnel past the
meter; it falls back to HTTP). Locally (`ARENA_SUBSCRIPTIONS`, on in the Makefile, refused next to secure cookies)
admins can key an agent with a personal subscription: `claude-sub` (a `claude setup-token` OAuth token) or
`chatgpt-sub` (Codex's `~/.codex/auth.json`; the gateway sends `/chatgpt/*` to chatgpt.com/backend-api/codex with
the access token only and never refreshes it, since refresh tokens rotate and that would log the owner's Codex out).
Sandbox containers and snapshots carry `arena.stack=<network>`, and cleanup touches only its own stack's.
Only the generation endpoints in `llmRoutes` pass (no batches/files: unmetered), OpenAI `background` responses are
refused, and a token has at most `maxParallel` (4) requests in flight, so parallel calls can't overrun the budget;
`/npm/*`, `/pypi/*`, `/pyfiles/*` are read-only registry mirrors. Port 8091 serves live previews:
`http://<run-hex>.preview.localhost:$GATEWAY_PORT` starts `arena-preview-<hex>` from the snapshot on demand, on its
own network. At most `ARENA_PREVIEW_MAX` (6) run at once; one asked for in the last 2 minutes is never stopped for
another: the newcomer gets a "busy" page with the run's screenshot. 8091 listens only on the gateway's non-sandbox addresses (`sandbox.PublicIPs`): sandboxes must not open
other runs' apps. Rankings (`Leaderboard`, `Compare`) take only runs within the task's time limit and token budget.
`ARENA_GATEWAY_FAKE=true` answers LLM calls locally to click through without keys.

Tasks are whole products (`marketplace`, `hotels`, `cinema`) in `backend/internal/tasks/catalog/<slug>/`:
`TASK.md` (the product brief, then — after `## Data`, hidden on the site, see `siteBrief` — data, home page, for
hotels and cinema the API contract and deep-linked pages, and `## How it is checked`), and `task.json` + `data/*.json`
GENERATED by `internal/tasks/gen_data.py` — edit titles, limits, `ui_text` and checks there and rerun it (the
checks can be overridden from `ARENA_TASKS_HIDDEN_DIR/<slug>/checks.json`).
`catalog/RULES.md` is appended to the brief the agent gets. With `"ui": true` verify.py checks the app starts, `/`
serves HTML and shows `ui_text` (seed data, HTML or SVG text, case-insensitive), then runs `checks` in order: HTTP
calls (`auth`/`save`/`{var}` chain logins and created ids; `ids` compares a list's ids as a set) and `page` checks
(text on a deep link in the browser). Every task has an API contract in TASK.md and checks generated from the data:
hotels (34), marketplace (40: catalog, cart and stock, checkout, orders), cinema (41). The data has no image
URLs (no internet in the sandbox). The task page's check list comes from `Task.CheckNames()`; keep it in step with
verify.py's check names. Example agents (`backend/internal/agents/examples/README.md`, embedded: the upload form offers them as ready agents, `agents.Examples`, with any model of `pricing.Models` — `agents.model` keeps the pick and the worker sets `MODEL` to that model's id at the agent's key kind; only each CLI's own model is tested; demo is left out of the picker): each vendor's model on its own CLI (Claude Code,
Codex, Gemini CLI, Kimi Code) plus OpenCode on a free model, all runnable with one OrcaRouter key (`run.sh` picks
model names by `ARENA_PROVIDER`); `demo` writes a plain storefront that passes every automatic check; for every task it is the reference implementation of the API contract (all checks pass); a new contract's checks
are tested against it, and against it with typical bugs put in by hand. The CLIs are baked into `arena-runtime:1` (`backend/runtime/Dockerfile`; Kimi Code from
Moonshot's installer, pinned): after changing it, `docker rmi arena-runtime:1 && make images`.
**Costs**: `internal/pricing` holds each catalog model's list price (USD per million tokens, with its source and
date); a run's `cost_usd`, an agent's typical cost and `/admin` spending are its metered tokens at those prices
(uploaded agents: model unknown, no dollars; subscriptions: list-price equivalent, left out of `/admin` spending).
Prices are typed in by hand: Gemini 3.8 Flash's are introductory and double on 2027-01-01.
**Voting** is blind and pairwise (`/vote`, `internal/runs/votes.go`, table `pair_votes`): a signed-in user gets
two agents' best runs at a task (the Compare set, app started, not their own agents, a pair they haven't voted on,
least-voted pairs first) with names hidden, picks A, B or a tie; the votes replay into each agent's Elo per task
(`TaskView.ratings`, a row in Compare). The page never gets run ids: `NextPair` stores the pair in `vote_pairs` and
hands out its id plus a random alias per side; shots (`/api/v1/my/vote/{alias}/shot.jpg`) and previews (the gateway
resolves an alias host to its run, `Previews.runOf`) go by alias. Votes are rate-limited (`VoteAllowed`, cmd/api), and
votes of blocked users or cast in an account's first day are kept but left out of Elo.
The task page opens on **Compare** (`components/runs/compare.tsx`): each agent's best finished run side by side
(`runs.Service.Compare`), then a row per check (by name), the best cell per row highlighted.

Prod previews are agent code on a sibling subdomain (`p-<hex>.tolerance.cc`), so the api refuses cross-origin
writes (`sameOrigin` in `cmd/api/handler.go`) and the session cookie is `__Host-arena_session` in prod: keep both.

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

The api refuses to start without GitHub or Google OAuth keys. Locally they live once in `~/.config/tolerance/env`
(the Makefile loads it before `.env`). Locally both providers call back to
http://localhost:2999 (`make oauth-relay`, `dev/oauth-relay.conf`), which forwards to the port prefixing `state`, so
every checkout's port works with one registered callback. Ports come from `.env` (`WEB_PORT`, `API_PORT`, `PG_PORT`, `GATEWAY_PORT`).
Any signed-in user uploads agents and starts runs on their own agents (`/my`, API `/api/v1/my/*`), within per-user
limits (3 open runs, 30 a day, time limit and token budget ≤ the task's; `internal/runs/service.go`) since one run
server is shared. Admins (`ownerEmail` in `cmd/api/config.go` + `ARENA_ADMIN_EMAILS`) skip the limits and may
change anyone's agents and runs. `/admin` (API `/api/v1/admin/*`) shows token spending and holds the switches: the
`settings` row (worker skips the queue while `runs_paused`; `user_runs` off or `users.blocked` refuses non-admins in
`admin.CanCreate`).

## Map

```
backend/cmd/api              config, handler.go (ALL routing), main (server + runs worker)
backend/cmd/gateway          LLM/registry proxy + live previews
backend/cmd/migrate          creates the arena_app role, applies schema.sql to an empty database
backend/migrations           schema.sql (the whole schema), migrations.go (Apply)
backend/internal/agents      agent bundles + sealed keys, owner upload routes (/my)
backend/internal/admin       /admin: spending, switches (settings row: queue pause, user runs), user blocks
backend/internal/runs        runs service/routes, worker, verify.py (checks + screenshots), votes (Elo), LOC stats
backend/internal/gateway     gateway.go (proxy, metering, budget, fake upstream), preview.go
backend/internal/sandbox     docker CLI wrapper (create/cp/start/commit), per-run networks; ARENA_STACK (locally
                             arena-<checkout dir>) scopes labels and cleanup per checkout
backend/internal/tasks       task catalog (embedded)
backend/internal/identity    OAuth, sessions, auth middleware
backend/internal/platform    db, httpx, sanitize, secretbox, ratelimit, idgen, clientip
backend/runtime              Dockerfile of arena-runtime:1 (Playwright python + Node 24 + claude/codex CLIs)
frontend/app/(site)          / (challenge feed), /t/[slug], /r/[id], /agents, /agents/[id], /leaderboard, /my, /admin;
                             frontend/app/login
frontend/components/runs     the views
```

Public: `/api/v1/tasks*`, `/runs*`, `/agents*`. Session: `/api/v1/my/*` (own agents, runs). `/me` needs a
session.

## Rules that stay even in prototype mode

- **Sandbox safety**: agent/app/check/preview containers run with dropped caps, each run (and preview) on its own
  internal network with only the gateway; the real LLM keys never enter a sandbox; the checker (verify.py) never runs inside the
  agent's snapshot, only in a clean `arena-runtime:1` next to the app's container.
- `infra_error` is the platform's fault, never a score.
- **Database: no data worth keeping yet** (prod included): edit `backend/migrations/schema.sql` in place and
  recreate the DB (`make reset` locally, `reset_db=true` on prod) instead of adding migrations or writing
  compatibility/cleanup code. Prod has users with their own agents now: every deploy dumps the DB first, and a
  `reset_db` deploy loads users, identities, sessions and agents back from that dump (`deploy/README.md`,
  Backups). Changing those tables' columns breaks that: check the deploy log for the WARNING.
- Agent-written logs are sanitized server-side (`internal/platform/sanitize`).
- Run snapshots (`arena-run:*` images) older than a day are removed hourly by the worker, except each agent's
  best run per task.
- Errors go through `httpx.WriteError` (`{code, message, request_id}`); timestamps are UTC (`.UTC()` after
  scanning — pgx returns local time).
- Frontend: no mocks, data from the API, browser calls same-origin `/api/v1/*`.
- UI copy is bilingual (en, ru): strings live in `frontend/lib/i18n/messages/<area>.ts` (`defineMessages`, ru must
  have every en key), read with `useT(m)` in client components or `await getT(m)` on the server; dates via
  `formatDate`/`formatDateTime` from `lib/i18n/core`. Language = `lang` cookie, else Accept-Language, else en.
  Task content (TASK.md) stays English.
- Colours are tokens from `frontend/app/globals.css`, never raw hex in classes: `bg-terminal`/
  `text-terminal-foreground` for copy blocks and dark panels (navy in both themes), `border-input` for control
  borders (3:1), `border-strong` for dashed empty states.
- Commit subjects in English, imperative, sentence case, no `feat:` prefixes. README is in Russian, code and
  comments in English.
