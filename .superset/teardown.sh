#!/usr/bin/env bash
# Superset workspace teardown: https://docs.superset.sh/setup-teardown-scripts
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=lib/portalloc.sh
source .superset/lib/portalloc.sh

echo "==> Stopping the dev server stack"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  COMPOSE="docker compose"
  docker compose version >/dev/null 2>&1 || COMPOSE="docker-compose"

  # down -v below drops this checkout's database for good: keep a dump of it first when it has runs (they may be
  # real runs, made with the owner's keys). make snapshot-load SNAPSHOT=<file> brings one back into a checkout.
  backups="${HOME}/.local/share/tolerance/teardown"
  if $COMPOSE up -d --wait postgres >/dev/null 2>&1; then
    runs=$($COMPOSE exec -T postgres psql -U arena_migrate -d arena -Atc "SELECT count(*) FROM runs" 2>/dev/null || echo 0)
    if [ "${runs:-0}" -gt 0 ] 2>/dev/null; then
      mkdir -p "$backups"
      backup="$backups/$(basename "$PWD")-$(date -u +%Y%m%dT%H%M%SZ).dump"
      echo "==> Saving the database ($runs runs) to $backup"
      if (umask 077 && $COMPOSE exec -T postgres pg_dump -U arena_migrate -d arena -Fc > "$backup.tmp"); then
        mv "$backup.tmp" "$backup"
        # The 20 newest are enough: each holds the agents' keys, so don't let them pile up.
        ls -t "$backups"/*.dump | tail -n +21 | xargs rm -f
      else
        rm -f "$backup.tmp"
        echo "  Could not dump the database; keeping its volume (docker volume ls | grep $(basename "$PWD"))" >&2
        exit 1
      fi
    fi
  fi

  # --rmi local: this checkout's own gateway image (<project>-gateway) goes too.
  $COMPOSE down -v --remove-orphans --rmi local
else
  echo "  Docker not available, nothing to stop" >&2
fi

echo "==> Releasing allocated ports"
arena_release_port_base || echo "  Could not release port allocation for $PWD" >&2

echo "==> Teardown complete"
