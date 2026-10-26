# The sandbox runtime (arena-runtime:1): agents build in it, the platform checks and previews the result in a
# snapshot of it. Chromium + Playwright for Python from the official image, plus Node 24 LTS, git, sqlite and the
# common agent CLIs (Claude Code, Codex, Gemini CLI, OpenCode, and Kimi Code from Moonshot's installer, which checks
# the binary's SHA-256). Containers from it have no network except the gateway.
FROM mcr.microsoft.com/playwright/python:v1.64.1-noble
ARG NODE_VERSION=24.22.1
ARG KIMI_CODE_VERSION=2.3.1
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git sqlite3 xz-utils jq ripgrep \
 && rm -rf /var/lib/apt/lists/* \
 && arch="$(dpkg --print-architecture)"; case "$arch" in amd64) arch=x64;; esac \
 && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1 --exclude='*.md' --exclude=LICENSE \
 && npm install -g --no-fund --no-audit @anthropic-ai/claude-code @openai/codex @google/gemini-cli opencode-ai \
 && npm cache clean --force \
 && pip install --no-cache-dir --break-system-packages playwright==1.64.1 \
 && curl -fsSL https://code.kimi.com/kimi-code/install.sh \
    | KIMI_VERSION="$KIMI_CODE_VERSION" KIMI_INSTALL_DIR=/opt/kimi-code KIMI_NO_MODIFY_PATH=1 bash \
 && ln -s /opt/kimi-code/bin/kimi /usr/local/bin/kimi \
 && mkdir -p /work /agent
ENV PYTHONDONTWRITEBYTECODE=1 NODE_OPTIONS=--max-old-space-size=3072
WORKDIR /work
