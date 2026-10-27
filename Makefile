.PHONY: oauth-relay down logs reset dev db gateway docker migrate run-api run-worker run-web images seed snapshot-save snapshot-load test test-fast

COMPOSE ?= $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo docker-compose)
# Secrets shared by every local checkout (OAuth keys): kept outside the repo so new workspaces don't need them
# copied into .env. Loaded first, so a value set in .env still wins.
LOCAL_SECRETS ?= $(HOME)/.config/tolerance/env
-include $(LOCAL_SECRETS)
-include .env
# docker compose (the gateway) reads it from the environment.
export ARENA_GATEWAY_FAKE
# Checkouts share the Docker host: each is its own stack, so its worker attaches its own gateway to its runs'
# networks and cleans up only its own sandboxes and snapshots.
ARENA_STACK ?= arena-$(notdir $(CURDIR))
export ARENA_STACK
# The site owner (always an admin, plays the tournament): ARENA_OWNER_EMAIL, best kept in $(LOCAL_SECRETS); unset =
# no owner. The owner may key agents with their own Claude / ChatGPT subscription (prod too: deploy/compose.yml).
export ARENA_OWNER_EMAIL
ARENA_SUBSCRIPTIONS ?= true
export ARENA_SUBSCRIPTIONS
# Sign in as any email with no password (the form under the OAuth buttons), so flows can be clicked through
# without OAuth; the api refuses it unless ARENA_PUBLIC_URL is localhost. ARENA_DEV_LOGIN=false turns it off.
ARENA_DEV_LOGIN ?= true
export ARENA_DEV_LOGIN
# Sign-in callbacks go through one fixed local port shared by every checkout (dev/oauth-relay.conf), so Google
# and GitHub need one registered callback whatever WEB_PORT is. Set it empty to call back to WEB_PORT directly.
ARENA_OAUTH_RELAY_URL ?= http://localhost:2999
export ARENA_OAUTH_RELAY_URL
WEB_PORT ?= 3000
API_PORT ?= 8080
PG_PORT ?= 5432
GATEWAY_PORT ?= 3023
ARENA_SECRET_KEY ?= dev-only-secret-key-change-me

down:
	$(COMPOSE) down

reset:
	$(COMPOSE) down -v

logs:
	$(COMPOSE) logs -f --tail=100

# Fastest loop: postgres in Docker, api, runs worker and web on the host (web hot-reloads;
# restart `make dev` after Go changes). Ctrl-C stops all three. The api and the worker are separate processes:
# restart one alone with `make run-api` / `make run-worker` in another terminal.
dev: .env docker images oauth-relay db migrate gateway
	@trap 'kill 0' INT TERM; \
	$(MAKE) --no-print-directory run-api & \
	$(MAKE) --no-print-directory run-worker & \
	$(MAKE) --no-print-directory run-web & \
	echo; echo "  site:  http://localhost:$(WEB_PORT)"; echo "  api:   http://localhost:$(API_PORT)/healthz"; echo; \
	wait

db: .env docker
	$(COMPOSE) up -d --wait postgres

# The sandboxes' way out (LLM APIs, npm, PyPI) and the live previews; always in Docker, since it joins each run's
# internal network. Rebuilt from backend/ on every start (cached when nothing changed).
gateway: .env docker
	$(COMPOSE) up -d --build gateway

# One database for every checkout: make snapshot-save where the real runs are (it holds real agents' keys, sealed with
# the dev secret, so it lives outside the repo, readable by you only), make snapshot-load in another checkout (new
# Superset workspaces load it in setup). A loaded copy doesn't spend anything by itself: its unfinished runs are
# cancelled and the weekly tournament is off. Run snapshots (live previews, recheck) stay with the checkout that made
# them, whose worker may remove them after a day; screenshots and sources are in the database.
SNAPSHOT ?= $(HOME)/.local/share/tolerance/snapshot.dump

snapshot-save: db
	@mkdir -p "$(dir $(SNAPSHOT))"
	@open=$$($(COMPOSE) exec -T postgres psql -U arena_migrate -d arena -Atc "SELECT count(*) FROM runs WHERE status IN ('queued', 'agent', 'checking')"); \
		[ "$$open" = 0 ] || echo "  note: $$open runs are still going: a loaded copy gets them cancelled"
	@umask 077 && $(COMPOSE) exec -T postgres pg_dump -U arena_migrate -d arena -Fc > "$(SNAPSHOT).tmp" && mv "$(SNAPSHOT).tmp" "$(SNAPSHOT)"
	@echo "saved $(SNAPSHOT) ($$(du -h "$(SNAPSHOT)" | cut -f1))"

snapshot-load: db
	@test -s "$(SNAPSHOT)" || { echo "no snapshot at $(SNAPSHOT): run make snapshot-save in the checkout with the runs"; exit 1; }
	$(COMPOSE) exec -T postgres psql -U arena_migrate -d postgres -v ON_ERROR_STOP=1 -q \
		-c 'DROP DATABASE IF EXISTS arena WITH (FORCE)' -c 'CREATE DATABASE arena'
	@$(COMPOSE) exec -T postgres psql -U arena_migrate -d arena -q -c 'CREATE ROLE arena_app' >/dev/null 2>&1 || true
	$(COMPOSE) exec -T postgres pg_restore -U arena_migrate -d arena --no-owner --exit-on-error < "$(SNAPSHOT)"
	$(COMPOSE) exec -T postgres psql -U arena_migrate -d arena -v ON_ERROR_STOP=1 -q \
		-c "UPDATE runs SET status = 'infra_error', failure_reason = 'cancelled', finished_at = now(), worker_id = NULL WHERE status IN ('queued', 'agent', 'checking')" \
		-c 'UPDATE settings SET tournament_since = NULL'
	$(MAKE) migrate
	@echo "loaded $(SNAPSHOT)"

migrate:
	cd backend && ARENA_MIGRATE_DATABASE_URL="postgres://arena_migrate:$(POSTGRES_PASSWORD)@127.0.0.1:$(PG_PORT)/arena?sslmode=disable" \
		ARENA_APP_ROLE_PASSWORD="$(ARENA_APP_ROLE_PASSWORD)" go run ./cmd/migrate

run-api:
	cd backend && ARENA_ADDR=127.0.0.1:$(API_PORT) \
		ARENA_APP_DATABASE_URL="postgres://arena_app:$(ARENA_APP_ROLE_PASSWORD)@127.0.0.1:$(PG_PORT)/arena?sslmode=disable" \
		ARENA_ADMIN_EMAILS="$(ARENA_ADMIN_EMAILS)" ARENA_SECRET_KEY="$(ARENA_SECRET_KEY)" \
		ARENA_PUBLIC_URL=$(or $(ARENA_PUBLIC_URL),http://localhost:$(WEB_PORT)) ARENA_OAUTH_RELAY_URL="$(ARENA_OAUTH_RELAY_URL)" \
		ARENA_PREVIEW_URL="http://{id}.preview.localhost:$(GATEWAY_PORT)" \
		ARENA_TASKS_HIDDEN_DIR="$(ARENA_TASKS_HIDDEN_DIR)" ARENA_RUN_CONCURRENCY="$(ARENA_RUN_CONCURRENCY)" \
		ARENA_GITHUB_CLIENT_ID="$(ARENA_GITHUB_CLIENT_ID)" ARENA_GITHUB_CLIENT_SECRET="$(ARENA_GITHUB_CLIENT_SECRET)" \
		ARENA_GOOGLE_CLIENT_ID="$(ARENA_GOOGLE_CLIENT_ID)" ARENA_GOOGLE_CLIENT_SECRET="$(ARENA_GOOGLE_CLIENT_SECRET)" \
		go run ./cmd/api

# Real runs for free: seeded agents built from the demo example run every task through the gateway switched to
# ARENA_GATEWAY_FAKE=true for the while (no keys, no tokens), then the gateway goes back to .env's setting. Works with
# or without `make dev` running; run it again to fill in what's missing. Live runs of your own during it get fake answers.
seed: .env docker images db migrate
	@restore() { echo "  gateway back to ARENA_GATEWAY_FAKE=$(or $(ARENA_GATEWAY_FAKE),false)"; $(COMPOSE) up -d gateway >/dev/null 2>&1; }; \
	trap restore EXIT; trap 'exit 130' INT TERM; \
	ARENA_GATEWAY_FAKE=true $(COMPOSE) up -d --build --wait gateway && \
	(cd backend && ARENA_GATEWAY_FAKE=true ARENA_SECRET_KEY="$(ARENA_SECRET_KEY)" \
		ARENA_APP_DATABASE_URL="postgres://arena_app:$(ARENA_APP_ROLE_PASSWORD)@127.0.0.1:$(PG_PORT)/arena?sslmode=disable" \
		ARENA_TASKS_HIDDEN_DIR="$(ARENA_TASKS_HIDDEN_DIR)" go run ./cmd/seed)

# One Ctrl-C drains (no new runs, the ones in flight finish), a second stops them.
run-worker:
	cd backend && ARENA_APP_DATABASE_URL="postgres://arena_app:$(ARENA_APP_ROLE_PASSWORD)@127.0.0.1:$(PG_PORT)/arena?sslmode=disable" \
		ARENA_TASKS_HIDDEN_DIR="$(ARENA_TASKS_HIDDEN_DIR)" ARENA_RUN_CONCURRENCY="$(ARENA_RUN_CONCURRENCY)" \
		ARENA_WORKER_DRAIN="$(ARENA_WORKER_DRAIN)" go run ./cmd/worker

run-web:
	cd frontend && API_URL=http://127.0.0.1:$(API_PORT) ARENA_PUBLIC_URL=$(or $(ARENA_PUBLIC_URL),http://localhost:$(WEB_PORT)) pnpm dev -p $(WEB_PORT)

# One container for all checkouts, outside any compose project, so stopping a stack leaves it up for the others.
# Recreated when dev/oauth-relay.conf changes.
OAUTH_RELAY := tolerance-oauth-relay
oauth-relay: docker
	@[ -z "$(ARENA_OAUTH_RELAY_URL)" ] || { \
	  sum=$$(shasum dev/oauth-relay.conf | cut -c1-12); \
	  [ "$$(docker inspect -f '{{index .Config.Labels "conf"}} {{.State.Running}}' $(OAUTH_RELAY) 2>/dev/null)" = "$$sum true" ] || { \
	    docker rm -f $(OAUTH_RELAY) >/dev/null 2>&1; \
	    docker create --name $(OAUTH_RELAY) --label conf=$$sum --restart unless-stopped -p 127.0.0.1:2999:80 nginx:1.27-alpine >/dev/null && \
	    docker cp dev/oauth-relay.conf $(OAUTH_RELAY):/etc/nginx/conf.d/default.conf && \
	    docker start $(OAUTH_RELAY) >/dev/null && echo "  oauth relay: http://localhost:2999"; }; }

# The sandbox runtime every agent, check and preview container starts from. Built only when missing;
# `docker rmi arena-runtime:1` to force a rebuild.
images:
	@docker image inspect arena-runtime:1 >/dev/null 2>&1 || docker build -t arena-runtime:1 backend/runtime

docker:
	@docker info >/dev/null 2>&1 || (command -v colima >/dev/null && colima start) || (echo "Docker is not running"; exit 1)

# Everyday check: fmt, vet, tests, typecheck. The database tests (internal/platform/db/dbtest) make their own
# throwaway databases in this checkout's postgres.
test-fast: db
	cd backend && test -z "$$(gofmt -l .)" && go vet ./... && \
		ARENA_TEST_DATABASE_URL="postgres://arena_migrate:$(POSTGRES_PASSWORD)@127.0.0.1:$(PG_PORT)/arena?sslmode=disable" go test ./...
	cd frontend && pnpm typecheck

# test-fast plus a production frontend build.
test: test-fast
	cd frontend && pnpm build

.env:
	cp .env.example .env
