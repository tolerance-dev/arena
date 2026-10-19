#!/bin/sh
set -eu

# Usage: entrypoint.sh [migrate|gateway]
#
# migrate:      run cmd/migrate once and exit (compose's one-shot service).
# gateway:      the sandboxes' way out (LLM, registries) and the live previews.
# (no argument): run the api — HTTP plus the runs worker, one process.
case "${1:-}" in
  migrate)
    exec migrate
    ;;
  gateway)
    exec gateway
    ;;
  *)
    exec api
    ;;
esac
