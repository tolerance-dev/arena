#!/usr/bin/env bash
# Superset workspace run: https://docs.superset.sh/setup-teardown-scripts
# The fast loop: postgres + gateway in Docker, api and web on the host (web hot-reloads). `make dev` also builds
# the arena-runtime:1 image when it is missing.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec make dev
