.PHONY: up down logs reset dev db gateway net docker migrate run-api run-web images test test-fast

COMPOSE ?= $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo docker-compose)
# Secrets shared by every local checkout (OAuth keys): kept outside the repo so new workspaces don't need them
# copied into .env. Loaded first, so a value set in .env still wins.
LOCAL_SECRETS ?= $(HOME)/.config/tolerance/env
-include $(LOCAL_SECRETS)
-include .env
# docker compose (make up / gateway) reads these from the environment.
export ARENA_GITHUB_CLIENT_ID ARENA_GITHUB_CLIENT_SECRET ARENA_GOOGLE_CLIENT_ID ARENA_GOOGLE_CLIENT_SECRET
WEB_PORT ?= 3000
API_PORT ?= 8080
PG_PORT ?= 5432
GATEWAY_PORT ?= 3023
ARENA_SECRET_KEY ?= dev-only-secret-key-change-me

# Everything in Docker.
up: .env docker images net
	$(COMPOSE) up --build -d
	@echo
	@echo "  site:  http://localhost:$(WEB_PORT)"
	@echo "  api:   http://localhost:$(API_PORT)/healthz"
	@echo "  previews: http://<run>.preview.localhost:$(GATEWAY_PORT)"
	@echo "  logs:  make logs"

down:
	$(COMPOSE) down

reset:
	$(COMPOSE) down -v

logs:
	$(COMPOSE) logs -f --tail=100

# Fastest loop: postgres in Docker, api and web on the host (web hot-reloads;
# restart `make dev` after Go changes). Ctrl-C stops both.
dev: .env docker images net db migrate gateway
	@trap 'kill 0' INT TERM; \
	$(MAKE) --no-print-directory run-api & \
	$(MAKE) --no-print-directory run-web & \
	echo; echo "  site:  http://localhost:$(WEB_PORT)"; echo "  api:   http://localhost:$(API_PORT)/healthz"; echo; \
	wait

db: .env docker
	$(COMPOSE) up -d --wait postgres

# The sandboxes' way out (LLM APIs, npm, PyPI) and the live previews; always in Docker, since it has to sit on
# the internal arena-agents network. Rebuilt from backend/ on every start (cached when nothing changed).
gateway: .env docker net
	$(COMPOSE) up -d --build gateway

# The internal network sandboxes run on: no route out, only the gateway.
net: docker
	@docker network inspect arena-agents >/dev/null 2>&1 || docker network create --internal arena-agents >/dev/null

migrate:
	cd backend && ARENA_MIGRATE_DATABASE_URL="postgres://arena_migrate:$(POSTGRES_PASSWORD)@127.0.0.1:$(PG_PORT)/arena?sslmode=disable" \
		ARENA_APP_ROLE_PASSWORD="$(ARENA_APP_ROLE_PASSWORD)" go run ./cmd/migrate

run-api:
	cd backend && ARENA_ADDR=127.0.0.1:$(API_PORT) \
		ARENA_APP_DATABASE_URL="postgres://arena_app:$(ARENA_APP_ROLE_PASSWORD)@127.0.0.1:$(PG_PORT)/arena?sslmode=disable" \
		ARENA_DEV_LOGIN=$(or $(ARENA_DEV_LOGIN),true) \
		ARENA_ADMIN_EMAILS="$(ARENA_ADMIN_EMAILS)" ARENA_SECRET_KEY="$(ARENA_SECRET_KEY)" \
		ARENA_PUBLIC_URL=$(or $(ARENA_PUBLIC_URL),http://localhost:$(WEB_PORT)) \
		ARENA_PREVIEW_URL="http://{id}.preview.localhost:$(GATEWAY_PORT)" ARENA_JUDGE_MODEL="$(ARENA_JUDGE_MODEL)" \
		ARENA_TASKS_HIDDEN_DIR="$(ARENA_TASKS_HIDDEN_DIR)" \
		ARENA_GITHUB_CLIENT_ID="$(ARENA_GITHUB_CLIENT_ID)" ARENA_GITHUB_CLIENT_SECRET="$(ARENA_GITHUB_CLIENT_SECRET)" \
		ARENA_GOOGLE_CLIENT_ID="$(ARENA_GOOGLE_CLIENT_ID)" ARENA_GOOGLE_CLIENT_SECRET="$(ARENA_GOOGLE_CLIENT_SECRET)" \
		go run ./cmd/api

run-web:
	cd frontend && API_URL=http://127.0.0.1:$(API_PORT) pnpm dev -p $(WEB_PORT)

# The sandbox runtime every agent, check and preview container starts from. Built only when missing;
# `docker rmi arena-runtime:1` to force a rebuild.
images:
	@docker image inspect arena-runtime:1 >/dev/null 2>&1 || docker build -t arena-runtime:1 backend/runtime

docker:
	@docker info >/dev/null 2>&1 || (command -v colima >/dev/null && colima start) || (echo "Docker is not running"; exit 1)

# Everyday check: fmt, vet, tests, typecheck.
test-fast:
	cd backend && test -z "$$(gofmt -l .)" && go vet ./... && go test ./...
	cd frontend && pnpm typecheck

# test-fast plus a production frontend build.
test: test-fast
	cd frontend && pnpm build

.env:
	cp .env.example .env
