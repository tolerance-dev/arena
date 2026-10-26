#!/bin/sh
set -eu

# Usage: entrypoint.sh [migrate|gateway|worker]
#
# migrate:      run cmd/migrate once and exit (compose's one-shot service).
# gateway:      the sandboxes' way out (LLM, registries) and the live previews.
# worker:       the runs worker: claims queued runs, runs agents and checks in sandboxes.
# (no argument): run the HTTP api.
case "${1:-}" in
  migrate)
    exec migrate
    ;;
  gateway)
    exec gateway
    ;;
  worker)
    exec worker
    ;;
  *)
    exec api
    ;;
esac
