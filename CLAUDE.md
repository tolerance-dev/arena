# CLAUDE.md

Guidance for Claude Code in this repository. Only what the code doesn't tell you, or what would trip up the next
session; read the code for the rest.

## Prototype mode — read first

The product concept still changes week to week. The goal is a working skeleton, fast. This overrides skills and
default habits:

- **Write code directly.** No brainstorming, specs, plans in `docs/`, subagent-driven development, TDD or reviews
  unless the user asks. A short list of steps in chat is enough.
- **Tests only where a bug is invisible on `make dev` and costs money or trust**: the gateway's metering, the
  score, run quotas, the queue order, blind voting and Elo (`internal/gateway`, `internal/runs`). None for handlers,
  pages or API shapes: they change weekly. Database tests take a throwaway DB from `dbtest.New(t)`
  (`internal/platform/db/dbtest`); when a change breaks one, fix the code or update the test, never skip it.
- **Done = `make test-fast` passes and the flow is clicked through on `make dev`.** CI (`ci.yml`: test-fast +
  `pnpm build`) runs on every PR.
- **Design: Product Hunt's layout, our tokens** (`DESIGN_REFERENCE.md`): 900px main column + 280px aside
  (`components/ui/columns.tsx`), feed rows with 52px counters (`components/ui/feed.tsx`), pill tabs and buttons;
  colours, type and radii from `globals.css`. Only real data: no upvotes, categories or search until the backend
  has them, an empty state instead of placeholders, no blocks that repeat another page.
- **Throw code away** when the concept changes (code, routes, pages, tests) rather than keeping it compatible.
- **No deploys or prod work by you**: never run `gh workflow run deploy` or touch the server or DNS (Bunny,
  Cloudflare; how they fit: `deploy/README.md` → Domains). When a change needs a deploy, give the user the command
  (`gh workflow run deploy`; `-f ref=<sha>` rolls back; schema changes need no flag, `-f reset_db=true` only wipes). A hand change on
  the server that must survive goes into `deploy/` (`deploy/README.md`).
- **Git: PRs merged by you.** `main` is protected. Branch from fresh `origin/main`, push, `gh pr create`, and once
  it is clean against `main`, test-fast passes and CI is green (`gh pr checks --watch`), `gh pr merge --squash`.
  Give the PR link. Never push to `main` or weaken the protection. Other sessions merge into `main` all the time:
  rebase before merging.
- **Docs**: `README.md` (Russian) is a short pitch + how to run. Update this file only with what would trip up the
  next session.

## What this is

**tolerance** (https://tolerance.cc; env vars `ARENA_*`, database `arena`): an arena where coding agents build
whole apps. A user uploads an agent (`run.sh` or a zip with it) plus its LLM key; a run gives it a task
(`TASK.md` + mock data) in a sandbox; the platform checks the app it wrote, and people compare apps in blind
pairwise votes (Elo per task). **There is no LLM judge** (removed: cost dollars a verdict, not reproducible); don't
bring one back unless asked. Monorepo: `backend/` (Go module `tolerance`), `frontend/` (Next.js, talks to the
backend over HTTP only).

Run (`internal/runs/worker.go`, its own process `cmd/worker`, apart from the api):
`queued → agent → checking → done | infra_error`. A run belongs to the worker that claimed it (`runs.worker_id`;
workers beat in `workers`): only a run whose worker stopped beating is reaped as infra_error, and SIGTERM drains (no
new claims, runs in flight finish) instead of killing.
- **queued**: round-robin between owners (`queueOrder`, `internal/runs/queue.go`); the same order gives the API's
  `queue_position`/`queue_wait_s`, so change them together.
- **agent**: `arena-runtime:1` container on the run's own internal network with only the gateway; LLM base URLs
  point at the gateway, `*_API_KEY` is a per-run token. Stopped on time limit, budget or cancel, then committed to
  the snapshot `arena-run:<hex>`.
- **checking**: sources come out of the snapshot with `docker cp`; the app runs from the snapshot
  (`sandbox.AppSpec`, 512 MB, same as a preview); `internal/runs/verify.py` runs the checks and screenshots from a
  clean `arena-runtime:1` container next to it.
- **score** = share of checks passed, 0..100; 0 if the app didn't start (`runs.Score`).

**Gateway** (`cmd/gateway`, `internal/gateway`): swaps the run token for the agent's real key, meters tokens into
`runs.tokens_*`, enforces the budget, mirrors npm/PyPI read-only, and serves live previews (port 8091). Metering
holes it closes on purpose — keep them closed: client `Accept-Encoding` dropped (encoded responses refused), streams
sniffed by their first bytes, streamed chat completions get `stream_options.include_usage` forced on, WebSocket
upgrades refused, only the generation endpoints in `llmRoutes` pass, OpenAI `background` refused, at most
`maxParallel` requests in flight per token. The budget is held by in-memory reservations per token (`budget.go`):
one gateway process only, and missing usage is charged as the whole reservation, never as zero. 8091 listens only on non-sandbox addresses: sandboxes must not reach
other runs' apps. `ARENA_GATEWAY_FAKE=true` answers LLM calls locally (no keys needed). After Go changes in the
gateway: `make gateway`.

**Tasks** (`backend/internal/tasks/catalog/<slug>/`: marketplace, hotels, cinema): `task.json` and `data/*.json`
are GENERATED by `internal/tasks/gen_data.py` — edit titles, limits, `ui_text` and checks there and rerun it.
`TASK.md` (English) has the brief, then after `## Data` (hidden on the site) the data, API contract and how it's
checked; `catalog/RULES.md` is appended for the agent. Check names shown on the task page come from
`Task.CheckNames()`: keep them in step with verify.py. The `demo` example agent is the reference implementation that
passes every check; test new checks against it. **Hidden checks** (`gen_data.py --hidden DIR`, loaded from
`ARENA_TASKS_HIDDEN_DIR`, prod: `deploy/README.md`) run after the public ones on randomly picked other records and
count in the score, shown only as `hidden check N` with no details: the repo is public, so never commit a set; a
public check that changes state needs the matching replay in the hidden generators.

**Example agents** (`backend/internal/agents/examples/`): one per vendor CLI plus OpenCode, all runnable with one
OrcaRouter key; the CLIs are baked into `arena-runtime:1` (`backend/runtime/Dockerfile`): after changing it,
`docker rmi arena-runtime:1 && make images`. **Costs**: list prices typed in by hand in `internal/pricing`
(Gemini 3.8 Flash's are introductory and double on 2027-01-01).

**Voting** (`internal/runs/votes.go`): the vote page never gets run ids — a pair is stored in `vote_pairs` and its
sides go by random aliases (shots, previews). Keep it that way, or votes stop being blind.

Prod previews are agent code on a sibling subdomain (`p-<hex>.tolerance.cc`), so the api refuses cross-origin
writes (`sameOrigin`, `cmd/api/handler.go`) and the prod session cookie is `__Host-arena_session`: keep both.

## Running locally

```sh
make dev         # postgres + gateway in Docker, migrate, api, worker and web natively (Ctrl-C stops them)
make reset       # drop the containers and the DB volume (make down keeps the DB)
make seed        # agents + real runs of every task (~1 min, fake gateway: no keys, no tokens)
make snapshot-save / snapshot-load   # share one DB between checkouts (~/.local/share/tolerance/snapshot.dump)
make images      # arena-runtime:1, built only when missing
make test-fast   # gofmt + go vet + go test (starts postgres for the DB tests) + pnpm typecheck
```

- Each checkout has its own DB volume (compose project = dir name), empty at first and removed with the
  workspace (`.superset/teardown.sh`): new workspaces load the shared snapshot in setup when there is one, else
  `make seed` fills it. Don't share one volume between checkouts. The snapshot holds real agents' keys: never commit
  or upload it; a loaded copy has its open runs cancelled and the weekly tournament off.
- Ports come from `.env` (`WEB_PORT`, `API_PORT`, `PG_PORT`, `GATEWAY_PORT`). Checkouts share the Docker host:
  `ARENA_STACK` (`arena-<checkout dir>`) scopes sandbox labels and cleanup per checkout.
- Stopping your dev servers: kill by your own listening ports (`lsof -ti tcp:$API_PORT -sTCP:LISTEN | xargs kill`;
  without `-sTCP:LISTEN` it also kills the web server, a client of the api) or PIDs, never
  `pkill -f "make dev"` or a similar pattern. Other checkouts' agents run on the same machine with prompts in their
  command line, and `pkill -f` matched and killed six of them at once.
- `make test-fast` sets the `arena_app` role's password to `test` in the dev postgres (roles are cluster-wide): a
  running api then fails on new connections, and restarting it fails to start until `make migrate`.
- Sign-in: `make dev` turns on `ARENA_DEV_LOGIN`, an email field under the OAuth buttons (any email, no password;
  the owner's email `identity.OwnerEmail` is admin). OAuth keys, when wanted, live in
  `~/.config/tolerance/env`; callbacks go through the shared relay on :2999 (`dev/oauth-relay.conf`).
- Browser checks: the Chrome extension hangs on `make dev` pages (#96). Headless Chromium from `arena-runtime:1`
  works: `docker run --add-host host.docker.internal:host-gateway -i arena-runtime:1 python3 - < script.py` against
  `http://host.docker.internal:$WEB_PORT` (allowed in `next.config.mjs`). Colima doesn't mount `/private/tmp`, so
  pass scripts on stdin and `docker cp` files out. API writes from that origin are refused (`sameOrigin`): sign in
  with curl and `Origin: http://localhost:$WEB_PORT` instead.

Users upload agents and start runs on `/my` within per-user limits (`internal/runs/service.go`); admins
(`identity.OwnerEmail` + `ARENA_ADMIN_EMAILS`) skip them. `/admin` has spending and the switches (pause the queue, close user
runs, block users).

**Tournament** (`internal/runs/tournament.go`): the owner's ready agents (the ones with a model) at every task, 3
runs each, on their own keys. The worker queues it weekly (Monday 03:00 UTC, once per ISO week across workers) when
the owner switched it on in `/admin`, or the owner starts one by hand; only the owner may, since it spends the
owner's keys and subscription. Its runs are ordinary ranked runs (`runs.tournament_id`), the owner's in the queue.

## Rules that stay even in prototype mode

- **Sandbox safety**: agent, app, check and preview containers run with dropped caps, each on its own internal
  network with only the gateway; real LLM keys never enter a sandbox; never run platform code (verify.py, tar,
  python) inside an agent's snapshot — the agent was root there.
- `infra_error` is the platform's fault, never a score.
- **Database**: a schema change is a new migration `backend/migrations/NNNN_name.sql` (`make migrate`, every deploy
  applies it); never edit an applied one (its hash is checked). Deploy migrates before swapping, and the old worker
  drains on the new schema for up to an hour: add tables and nullable/defaulted columns, drop or rename only one
  release after the code stopped using them. New tables need their `GRANT ... TO arena_app`.
- Agent-written logs are sanitized server-side (`internal/platform/sanitize`).
- Errors go through `httpx.WriteError` (`{code, message, request_id}`); timestamps are UTC (`.UTC()` after
  scanning: pgx returns local time).
- Frontend: no mocks, data from the API, the browser calls same-origin `/api/v1/*`.
- UI copy is Russian only, inline in the components; plurals via `plural()` (`lib/format`), API errors via
  `errorText()` (`lib/errors`). Task content (TASK.md) stays English.
- Colours are tokens from `globals.css`, never raw hex: `bg-terminal`/`text-terminal-foreground` for code blocks
  and dark panels, `border-input` for control borders, `border-strong` for dashed empty states.
- Commit subjects in English, imperative, sentence case, no `feat:` prefixes. Code and comments in English.
