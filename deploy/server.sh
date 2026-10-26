#!/usr/bin/env bash
# Runs ON the server (/opt/tolerance) as `deploy`, called by .github/workflows/deploy.yml after it has synced
# compose.yml and Caddyfile next to this file and logged docker into ghcr.io.
#
#   server.sh deploy <sha> [reset]   pull images at <sha>, migrate, swap api/gateway/web,
#                                    health-check; on a failed health check the previous tag is started again
#                                    (migrations are not reverted). Once healthy, a new worker starts and the old
#                                    one drains in the background (swap_worker). `reset` wipes the database first
#                                    (only to start over: schema changes are migrations, backend/migrations).
#   server.sh backup [label]         pg_dump into backups/ (keeps the newest 30); cron runs it daily, deploy before
#                                    every swap (a failed dump stops a reset)
#                                    and, when BACKUP_REMOTE is set in .env, an encrypted copy off the server
#   server.sh offsite-get <name>     fetch and decrypt an off-site copy into backups/ (for restore)
#   server.sh restore <dump> [table...]
#                                    whole dump back (api/gateway/web stopped meanwhile), or only these tables' rows
#                                    into the current schema (e.g. users user_identities agents after a reset)
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

BACKUPS=backups
KEEP_BACKUPS=30
LAST_BACKUP=
# What a reset brings back from the dump it made: people, their sign-ins and their agents (not runs).
KEEP_ON_RESET=(users user_identities sessions agents)

cmd_backup() {
  local f
  mkdir -p "$BACKUPS"
  # A stopped postgres still has its volume: start it rather than skip (a reset would wipe that volume next).
  dc up -d --wait postgres || return 1
  f="$BACKUPS/arena-$(date -u +%Y%m%dT%H%M%SZ)${1:+-$1}.dump"
  # Explicit checks: callers run this under `if`, where set -e is off.
  if ! dc exec -T postgres pg_dump -U arena_migrate -d arena -Fc > "$f.tmp" || [ ! -s "$f.tmp" ]; then
    rm -f "$f.tmp"
    echo "pg_dump failed" >&2
    return 1
  fi
  mv "$f.tmp" "$f" || return 1
  LAST_BACKUP=$f
  # shellcheck disable=SC2012 # our own file names, no spaces
  ls -1t "$BACKUPS"/arena-*.dump | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
  echo "--- backup $f ($(du -h "$f" | cut -f1))"
  # The off-site copy is extra: its failure doesn't fail the backup (a deploy goes on, the local dump is there).
  offsite_put "$f" || echo "WARNING: off-site copy of $f failed" >&2
}

# Off-site copies: the dump, encrypted with BACKUP_PASSPHRASE (openssl, AES-256), copied by rclone (in a container,
# nothing to install) to BACKUP_REMOTE, e.g. offsite:tolerance-backups/arena. The remote is configured by
# RCLONE_CONFIG_<NAME>_* lines in .env (rclone's env config; for Cloudflare R2: _TYPE=s3 _PROVIDER=Cloudflare
# _ACCESS_KEY_ID _SECRET_ACCESS_KEY _ENDPOINT). Copies older than OFFSITE_DAYS are deleted there.
RCLONE_IMAGE=rclone/rclone:1.68.2
OFFSITE_DAYS=30
envval() { grep "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-; }
rclone() {
  docker run --rm --env-file <(grep '^RCLONE_' .env) -v "$PWD/$BACKUPS:/data" "$RCLONE_IMAGE" "$@"
}

offsite_put() {
  local f=$1 remote pass name
  remote=$(envval BACKUP_REMOTE)
  [ -n "$remote" ] || return 0
  pass=$(envval BACKUP_PASSPHRASE)
  [ -n "$pass" ] || { echo "BACKUP_REMOTE is set but BACKUP_PASSPHRASE is empty" >&2; return 1; }
  name=$(basename "$f").enc
  BACKUP_PASSPHRASE=$pass openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE \
    -in "$f" -out "$BACKUPS/$name" || return 1
  rclone copyto "/data/$name" "$remote/$name" --s3-no-check-bucket; local rc=$?
  rm -f "$BACKUPS/$name"
  [ $rc -eq 0 ] || return 1
  rclone delete --min-age "${OFFSITE_DAYS}d" "$remote" || true
  echo "--- off-site $remote/$name"
}

cmd_offsite_get() {
  local name=$1 remote pass out
  remote=$(envval BACKUP_REMOTE); pass=$(envval BACKUP_PASSPHRASE)
  [ -n "$remote" ] && [ -n "$pass" ] || { echo "BACKUP_REMOTE / BACKUP_PASSPHRASE not set in .env" >&2; exit 1; }
  mkdir -p "$BACKUPS"
  rclone copyto "$remote/$name" "/data/$name"
  out="$BACKUPS/${name%.enc}"
  BACKUP_PASSPHRASE=$pass openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE \
    -in "$BACKUPS/$name" -out "$out"
  rm -f "$BACKUPS/$name"
  echo "--- $out (server.sh restore $out)"
}

cmd_restore() {
  local f=$1; shift
  [ -s "$f" ] || { echo "no such dump: $f" >&2; exit 1; }
  cmd_backup pre-restore
  if [ $# -eq 0 ]; then
    dc stop api gateway web
    dc stop -t 10 worker
    dc exec -T postgres pg_restore -U arena_migrate -d arena --clean --if-exists --no-owner < "$f"
    dc up -d
  else
    cmd_restore_rows "$f" "$@"
  fi
  echo "--- restored $f${1:+ ($*)}"
}

# Rows of these tables only, into the schema the current code made, in one transaction (all or nothing);
# triggers (FKs) are off while loading.
cmd_restore_rows() {
  local f=$1 t args=(); shift
  for t in "$@"; do args+=(-t "$t"); done
  dc exec -T postgres pg_restore -U arena_migrate -d arena --data-only --disable-triggers --single-transaction \
    --exit-on-error "${args[@]}" < "$f"
}

# Daily dump at 03:17 UTC, in the deploy user's crontab (installed on every deploy, idempotent).
install_cron() {
  local line
  if ! command -v crontab >/dev/null; then
    echo "WARNING: no crontab on this host, daily backups are off" >&2
    return 0
  fi
  mkdir -p "$BACKUPS"
  line="17 3 * * * bash $PWD/server.sh backup daily >> $PWD/$BACKUPS/cron.log 2>&1"
  (crontab -l 2>/dev/null | grep -v 'server.sh backup' || true; echo "$line") | crontab -
}

# Everything but the worker (swap_worker has its own way), for the deploy and its rollback. Only the active profiles'
# services (COMPOSE_PROFILES in .env): naming a profiled service on the command line would start it.
up_but_worker() {
  # shellcheck disable=SC2046
  dc up -d "$@" $(dc config --services | grep -vx worker)
}

# A stopping worker drains: no new claims, the runs in flight finish (ARENA_WORKER_DRAIN, up to an hour). So the new
# worker starts next to the old one(s), which are stopped in the background and removed once drained; the runs cap
# counts every worker's runs, so the overlap puts no more agents on the host. worker-swap.log says how it ended.
swap_worker() {
  local old n
  old=$(dc ps -aq worker | tr '\n' ' ')
  n=$(echo "$old" | wc -w)
  dc up -d --no-deps --no-recreate --scale "worker=$((n + 1))" worker
  if [ -n "$old" ]; then
    echo "--- old worker draining in the background (worker-swap.log)"
    setsid nohup sh -c "docker stop -t 3900 $old; docker rm $old" > worker-swap.log 2>&1 < /dev/null &
  fi
}

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
  # Caddy gets the certificates through Bunny DNS (see the Caddyfile): without the key it can't.
  if ! grep -q '^BUNNY_API_KEY=.' .env; then
    echo "BUNNY_API_KEY is missing from .env (Bunny's account API key, for Caddy's certificates; see the Caddyfile)" >&2
    exit 1
  fi
  # The hidden checks (README.md), copied in by hand; made here so the api's bind mount isn't a root-owned dir.
  mkdir -p tasks-hidden
  prev=$(grep '^TAG=' .env | cut -d= -f2 || true)
  # Seals agents' LLM keys at rest; must survive restarts (a new one makes stored agent keys unreadable).
  grep -q '^ARENA_SECRET_KEY=.' .env || setenv ARENA_SECRET_KEY "$(openssl rand -hex 32)"

  echo "--- pull $tag"
  for img in backend web runtime caddy; do
    docker pull -q "$REGISTRY/tolerance-$img:$tag"
  done
  runtime_image "$tag"

  install_cron
  if ! cmd_backup "pre-${tag:0:7}"; then
    if [ "$reset" = "reset" ]; then
      echo "backup failed; not wiping the database" >&2
      exit 1
    fi
    echo "WARNING: backup failed, deploying anyway" >&2
  fi

  # compose.yml needs TAG set for any command, postgres-only ones included.
  setenv TAG "$tag"

  if [ "$reset" = "reset" ]; then
    echo "--- reset database"
    dc stop api gateway web || true
    # Its runs go with the database: no drain. Removed, so the swap starts a fresh one instead of starting it again.
    dc stop -t 10 worker || true
    dc rm -f worker || true
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

  if [ "$reset" = "reset" ] && [ -n "$LAST_BACKUP" ]; then
    echo "--- bring back ${KEEP_ON_RESET[*]}"
    if ! cmd_restore_rows "$LAST_BACKUP" "${KEEP_ON_RESET[@]}"; then
      echo "WARNING: rows did not fit the new schema; they are in $LAST_BACKUP" >&2
    fi
  fi

  echo "--- up"
  # --remove-orphans drops services this file no longer has.
  up_but_worker --remove-orphans
  docker exec "$(dc ps -q caddy)" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

  if healthy; then
    [ -n "$prev" ] && [ "$prev" != "$tag" ] && echo "$prev" > .prev-tag
    swap_worker
    echo "--- deployed $tag"
    # Every deploy pulls a ~6 GB runtime image; keep only this tag and the rollback target, or the 30 GB disk fills
    # up and takes postgres down with it (2026-10-26).
    docker images --format '{{.Repository}}:{{.Tag}}' | grep "^$REGISTRY/tolerance-" \
      | grep -v -e ":$tag\$" ${prev:+-e ":$prev\$"} | xargs -r docker rmi >/dev/null 2>&1 || true
    docker image prune -f >/dev/null
    docker builder prune -af >/dev/null 2>&1 || true
    return 0
  fi

  echo "health check failed on $tag; logs:" >&2
  dc logs --tail=80 api gateway web >&2 || true
  if [ -n "$prev" ] && [ "$prev" != "$tag" ]; then
    echo "--- rolling back to $prev" >&2
    setenv TAG "$prev"
    runtime_image "$prev" || true
    up_but_worker
  fi
  exit 1
}

cmd_status() {
  echo "TAG=$(grep '^TAG=' .env | cut -d= -f2)"
  dc ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}'
}

case "${1:-}" in
  deploy) cmd_deploy "${2:?usage: server.sh deploy <sha> [reset]}" "${3:-}" ;;
  backup) cmd_backup "${2:-}" ;;
  offsite-get) cmd_offsite_get "${2:?usage: server.sh offsite-get <name>.dump.enc}" ;;
  restore) shift; cmd_restore "${1:?usage: server.sh restore <dump> [table...]}" "${@:2}" ;;
  status) cmd_status ;;
  *) echo "usage: server.sh deploy <sha> [reset] | backup [label] | restore <dump> [table...] | status" >&2; exit 2 ;;
esac
