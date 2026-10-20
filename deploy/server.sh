#!/usr/bin/env bash
# Runs ON the server (/opt/tolerance) as `deploy`, called by .github/workflows/deploy.yml after it has synced
# compose.yml and Caddyfile next to this file and logged docker into ghcr.io.
#
#   server.sh deploy <sha> [reset]   pull images at <sha>, migrate, swap api/gateway/web,
#                                    health-check; on a failed health check the previous tag is started again
#                                    (migrations are not reverted). `reset` wipes the database first: the schema
#                                    is edited in place, so a schema change needs it.
#   server.sh status                 what runs and at which tag
set -euo pipefail
cd "$(dirname "$0")"

REGISTRY=ghcr.io/tolerance-dev
dc() { docker compose -f compose.yml "$@"; }

# setenv KEY VALUE: replace or append a line in .env.
setenv() {
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}

# The api starts agent and check containers from this fixed local name.
runtime_image() { docker tag "$REGISTRY/tolerance-runtime:$1" arena-runtime:1; }

healthy() {
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null http://127.0.0.1:8080/healthz && curl -fsS -o /dev/null http://127.0.0.1:3000/; then
      return 0
    fi
    sleep 2
  done
  return 1
}

cmd_deploy() {
  local tag=$1 reset=${2:-} prev
  # The previews' certificate (see the Caddyfile): without it Caddy can't load its config.
  if [ ! -s origin-tls/cert.pem ] || [ ! -s origin-tls/key.pem ]; then
    echo "origin-tls/cert.pem and key.pem are missing (the Cloudflare Origin CA certificate for the previews, see the Caddyfile)" >&2
    exit 1
  fi
  prev=$(grep '^TAG=' .env | cut -d= -f2 || true)
  # Seals agents' LLM keys at rest; must survive restarts (a new one makes stored agent keys unreadable).
  grep -q '^ARENA_SECRET_KEY=.' .env || setenv ARENA_SECRET_KEY "$(openssl rand -hex 32)"

  echo "--- pull $tag"
  for img in backend web runtime; do
    docker pull -q "$REGISTRY/tolerance-$img:$tag"
  done
  runtime_image "$tag"
  docker network inspect arena-agents >/dev/null 2>&1 || docker network create --internal arena-agents >/dev/null

  # compose.yml needs TAG set for any command, postgres-only ones included.
  setenv TAG "$tag"

  # No backups: there is no data worth keeping yet.
  if [ "$reset" = "reset" ]; then
    echo "--- reset database"
    dc stop api gateway web || true
    dc rm -sf postgres
    docker volume rm -f tolerance_arena-postgres-data
  fi
  dc up -d --wait postgres

  echo "--- migrate"
  if ! dc run --rm migrate; then
    [ -n "$prev" ] && setenv TAG "$prev"
    echo "migrate failed; api and web untouched" >&2
    exit 1
  fi

  echo "--- up"
  # --remove-orphans drops services this file no longer has.
  dc up -d --remove-orphans
  docker exec "$(dc ps -q caddy)" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

  if healthy; then
    [ -n "$prev" ] && [ "$prev" != "$tag" ] && echo "$prev" > .prev-tag
    echo "--- deployed $tag"
    docker image prune -f >/dev/null
    return 0
  fi

  echo "health check failed on $tag; logs:" >&2
  dc logs --tail=80 api gateway web >&2 || true
  if [ -n "$prev" ] && [ "$prev" != "$tag" ]; then
    echo "--- rolling back to $prev" >&2
    setenv TAG "$prev"
    runtime_image "$prev" || true
    dc up -d
  fi
  exit 1
}

cmd_status() {
  echo "TAG=$(grep '^TAG=' .env | cut -d= -f2)"
  dc ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}'
}

case "${1:-}" in
  deploy) cmd_deploy "${2:?usage: server.sh deploy <sha> [reset]}" "${3:-}" ;;
  status) cmd_status ;;
  *) echo "usage: server.sh deploy <sha> [reset] | status" >&2; exit 2 ;;
esac
