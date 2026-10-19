# The sandbox runtime (arena-runtime:1): agents build in it, the platform checks and previews the result in a
# snapshot of it. Chromium + Playwright for Python from the official image, plus Node 22, git, sqlite and the
# common agent CLIs (Claude Code, Codex). Containers from it have no network except the gateway.
FROM mcr.microsoft.com/playwright/python:v1.52.0-noble
ARG NODE_VERSION=22.12.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git sqlite3 xz-utils jq ripgrep \
 && rm -rf /var/lib/apt/lists/* \
 && arch="$(dpkg --print-architecture)"; case "$arch" in amd64) arch=x64;; esac \
 && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1 --exclude='*.md' --exclude=LICENSE \
 && npm install -g --no-fund --no-audit @anthropic-ai/claude-code @openai/codex \
 && npm cache clean --force \
 && pip install --no-cache-dir --break-system-packages anthropic playwright==1.52.0 \
 && mkdir -p /work /agent
ENV PYTHONDONTWRITEBYTECODE=1 NODE_OPTIONS=--max-old-space-size=3072
WORKDIR /work
