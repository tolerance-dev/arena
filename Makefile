.PHONY: up down logs reset dev db gateway net docker migrate run-api run-web images test test-fast check

COMPOSE ?= $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo docker-compose)
-include .env
WEB_PORT ?= 3000
API_PORT ?= 8080
PG_PORT ?= 5432
GATEWAY_PORT ?= 3023
ARENA_SECRET_KEY ?= dev-only-secret-key-change-me
# Group that owns docker.sock as containers see it: the api container runs as
# a non-root user and needs that group to reach the daemon for sandbox runs.
# Asked of the daemon itself because on macOS (colima, Docker Desktop) the
# socket lives in a VM. Only expanded by `up`; set DOCKER_GID in .env to override.
DOCKER_GID ?= $(shell docker run --rm -v /var/run/docker.sock:/var/run/docker.sock alpine:3.22 stat -c %g /var/run/docker.sock 2>/dev/null)

# Everything in Docker.
up: .env docker images net
	DOCKER_GID=$(DOCKER_GID) $(COMPOSE) up --build -d
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
	DOCKER_GID=$(DOCKER_GID) $(COMPOSE) up -d --build gateway

# The internal network sandboxes run on: no route out, only the gateway.
net: docker
	@docker network inspect arena-agents >/dev/null 2>&1 || docker network create --internal arena-agents >/dev/null

migrate:
	cd backend && ARENA_MIGRATE_DATABASE_URL="postgres://arena_migrate:$(POSTGRES_PASSWORD)@127.0.0.1:$(PG_PORT)/arena?sslmode=disable" \
		ARENA_APP_ROLE_PASSWORD="$(ARENA_APP_ROLE_PASSWORD)" go run ./cmd/migrate

run-api:
	cd backend && ARENA_ADDR=127.0.0.1:$(API_PORT) \
		ARENA_APP_DATABASE_URL="postgres://arena_app:$(ARENA_APP_ROLE_PASSWORD)@127.0.0.1:$(PG_PORT)/arena?sslmode=disable" \
		ARENA_DEV_LOGIN=$(or $(ARENA_DEV_LOGIN),true) ARENA_NO_LIMITS=$(or $(ARENA_NO_LIMITS),true) \
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

# Everyday check: vet, the few remaining tests, typecheck.
test-fast:
	cd backend && go vet ./... && go test ./...
	cd frontend && pnpm typecheck

# Everything, the way CI runs it.
test:
	cd backend && ARENA_TEST_REQUIRE_DOCKER=1 go test -race ./...
	cd frontend && pnpm typecheck && pnpm build

check:
	cd backend && go vet ./... && test -z "$$(gofmt -l .)"

.env:
	cp .env.example .env
