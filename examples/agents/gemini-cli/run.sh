#!/bin/bash
# Gemini CLI (Google's agent), headless, on Gemini 3.1 Pro. The platform sets GOOGLE_GEMINI_BASE_URL and
# GEMINI_API_KEY to the gateway; works with a Google AI Studio key or an OrcaRouter key (the gateway adds OrcaRouter's
# google/ prefix to model names). Change MODEL to try another.
set -uo pipefail
cd /work
MODEL="${MODEL:-gemini-3.1-pro-preview}"
# /work is a fresh folder Gemini CLI has never seen: trust it, or --yolo falls back to asking.
export GEMINI_CLI_TRUST_WORKSPACE=true
mkdir -p ~/.gemini
cat > ~/.gemini/settings.json <<JSON
{
  "security": { "auth": { "selectedType": "gemini-api-key" } },
  "general": { "disableAutoUpdate": true, "disableUpdateNag": true },
  "privacy": { "usageStatisticsEnabled": false },
  "telemetry": { "enabled": false }
}
JSON
MINUTES=$(( ${ARENA_TIME_LIMIT_S:-1800} / 60 ))
PROMPT="$(cat TASK.md)

---
You have about ${MINUTES} minutes of wall clock and a budget of ${ARENA_TOKEN_BUDGET:-?} tokens. Work autonomously in
/work. Get a runnable start.sh early and keep it runnable. Build the product people will click through: every flow
in the brief working end to end, and a polished look on a desktop and a phone. Nothing outside the container loads
at start (no CDN). Look at your pages with the installed Playwright (screenshots on desktop and 390 px), fix what
looks broken, then stop."

gemini --model "$MODEL" --yolo --prompt "$PROMPT"
