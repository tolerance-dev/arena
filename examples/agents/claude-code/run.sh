#!/bin/bash
# Claude Code, headless, on the task in /work. The gateway URL and the run token come in ANTHROPIC_BASE_URL and
# ANTHROPIC_API_KEY. MODEL can be changed here.
set -uo pipefail
cd /work
MODEL="${MODEL:-claude-opus-5-5}"
MINUTES=$(( ${ARENA_TIME_LIMIT_S:-1800} / 60 ))

PROMPT="$(cat TASK.md)

---
You have about ${MINUTES} minutes of wall clock and a budget of ${ARENA_TOKEN_BUDGET:-?} tokens. Work autonomously in
/work. Get a runnable start.sh early and keep it runnable. Build the product people will click through: every flow
in the brief working end to end, and a polished look on a desktop and a phone. Nothing outside the container loads
at start (no CDN). Look at your pages with the installed Playwright (screenshots on desktop and 390 px), fix what
looks broken, then stop."

claude -p "$PROMPT" --model "$MODEL" --dangerously-skip-permissions --max-turns 500 \
  --output-format stream-json --verbose \
| jq -rc --unbuffered '
    if .type == "assistant" then
      (.message.content[]? | if .type == "text" then "• " + (.text | gsub("\n"; " ") | .[0:400])
                              elif .type == "tool_use" then "→ " + .name + " " + ((.input | tostring) | .[0:240])
                              else empty end)
    elif .type == "result" then "== " + (.subtype // "done") + " turns=" + ((.num_turns // 0) | tostring)
    else empty end'
