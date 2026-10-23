#!/bin/bash
# Gemini CLI (Google's agent), headless, on Gemini 3.8 Flash. The platform sets GOOGLE_GEMINI_BASE_URL and
# GEMINI_API_KEY to the gateway; works with a Google AI Studio key or an OrcaRouter key (the gateway adds OrcaRouter's
# google/ prefix to model names). Gemini subscriptions don't work: Google no longer lets individuals use Gemini CLI
# on one (Code Assist answers UNSUPPORTED_CLIENT). Change MODEL to try another.
set -uo pipefail
cd /work
MODEL="${MODEL:-gemini-3.8-flash}"
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
# Gemini CLI gives a response 60 s to start (undici headersTimeout, set inside the CLI, no setting for it). Through a
# router a long tool call starts later, so the CLI aborted and retried about every fourth request. Raise the limit
# when the CLI installs its global HTTP agent.
cat > ~/.gemini/timeouts.cjs <<'JS'
const key = Symbol.for("undici.globalDispatcher.1");
const define = Object.defineProperty;
Object.defineProperty = function (obj, prop, desc) {
  if (obj === globalThis && prop === key && desc && desc.value && !desc.value.arenaTimeouts) {
    try {
      const agent = new desc.value.constructor({ headersTimeout: 600000, bodyTimeout: 600000 });
      agent.arenaTimeouts = true;
      desc = { ...desc, value: agent };
    } catch {}
  }
  return define(obj, prop, desc);
};
JS
export NODE_OPTIONS="${NODE_OPTIONS:-} --require $HOME/.gemini/timeouts.cjs"
MINUTES=$(( ${ARENA_TIME_LIMIT_S:-1800} / 60 ))
PROMPT="$(cat TASK.md)

---
You have about ${MINUTES} minutes of wall clock and a budget of ${ARENA_TOKEN_BUDGET:-?} tokens. Work autonomously in
/work. Get a runnable start.sh early and keep it runnable. Build the product people will click through: every flow
in the brief working end to end, and a polished look on a desktop and a phone. Nothing outside the container loads
at start (no CDN). In this headless mode write_file and replace refuse build files (package.json, lock files): create
and change them from the shell instead (npm init -y, npm pkg set, npm install, or a heredoc). Look at your pages with the installed Playwright (screenshots on desktop and 390 px), fix what
looks broken, then stop."

gemini --model "$MODEL" --yolo --prompt "$PROMPT"
