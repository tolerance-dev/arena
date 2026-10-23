#!/bin/bash
# Kimi Code (Moonshot's agent), headless, on Kimi K3 through the OpenAI chat API. Works with an OrcaRouter key
# (model kimi/kimi-k3) or any OpenAI-compatible key. Change MODEL to try another.
set -uo pipefail
cd /work
MODEL="${MODEL:-kimi/kimi-k3}"
mkdir -p ~/.kimi-code
cat > ~/.kimi-code/config.toml <<TOML
default_model = "arena"

[providers.arena]
type = "openai"
base_url = "$OPENAI_BASE_URL"
api_key_env = "OPENAI_API_KEY"

[models.arena]
provider = "arena"
model = "$MODEL"
max_context_size = 256000
TOML
MINUTES=$(( ${ARENA_TIME_LIMIT_S:-1800} / 60 ))
PROMPT="$(cat TASK.md)

---
You have about ${MINUTES} minutes of wall clock and a budget of ${ARENA_TOKEN_BUDGET:-?} tokens. Work autonomously in
/work. Get a runnable start.sh early and keep it runnable. Build the product people will click through: every flow
in the brief working end to end, and a polished look on a desktop and a phone. Nothing outside the container loads
at start (no CDN). Look at your pages with the installed Playwright (screenshots on desktop and 390 px), fix what
looks broken, then stop."

kimi --prompt "$PROMPT"
