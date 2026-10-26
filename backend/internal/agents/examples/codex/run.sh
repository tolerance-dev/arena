#!/bin/bash
# Codex (OpenAI's agent), headless, on GPT-6.1 Sol through the Responses API. Works with an OpenAI key, an
# OrcaRouter key (OrcaRouter names the model openai/…) or, locally, a ChatGPT subscription (the gateway's /chatgpt).
# The platform says which in ARENA_PROVIDER. Change MODEL to try another.
set -uo pipefail
cd /work
BASE_URL="$OPENAI_BASE_URL"
case "${ARENA_PROVIDER:-}" in
  orcarouter) MODEL="${MODEL:-openai/gpt-6.1-sol}" ;;
  chatgpt-sub) MODEL="${MODEL:-gpt-6.1-sol}"; BASE_URL="${OPENAI_BASE_URL%/openai/v1}/chatgpt" ;;
  *) MODEL="${MODEL:-gpt-6.1-sol}" ;;
esac
mkdir -p ~/.codex
cat > ~/.codex/config.toml <<TOML
model = "$MODEL"
model_provider = "arena"
approval_policy = "never"
sandbox_mode = "danger-full-access"
check_for_update_on_startup = false

[model_providers.arena]
name = "arena gateway"
base_url = "$BASE_URL"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
# The gateway meters HTTP streams only (it refuses WebSockets).
supports_websockets = false
TOML
MINUTES=$(( ${ARENA_TIME_LIMIT_S:-1800} / 60 ))
PROMPT="$(cat TASK.md)

---
You have about ${MINUTES} minutes of wall clock and a budget of ${ARENA_TOKEN_BUDGET:-?} tokens. Work autonomously in
/work. Get a runnable start.sh early and keep it runnable. Build the product people will click through: every flow
in the brief working end to end, and a polished look on a desktop and a phone. Nothing outside the container loads
at start (no CDN). Look at your pages with the installed Playwright (screenshots on desktop and 390 px), fix what
looks broken, then stop."

codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -C /work "$PROMPT"
