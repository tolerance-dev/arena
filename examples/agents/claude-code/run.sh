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
/work and keep it small: one server file plus one page at /, no external dependencies and no CDN (nothing is
reachable at start). Keep start.sh runnable; test every route of the contract with curl once, open the page's data
calls the same way, fix what fails, then stop."

claude -p "$PROMPT" --model "$MODEL" --dangerously-skip-permissions --max-turns 500 \
  --output-format stream-json --verbose \
| jq -rc --unbuffered '
    if .type == "assistant" then
      (.message.content[]? | if .type == "text" then "• " + (.text | gsub("\n"; " ") | .[0:400])
                              elif .type == "tool_use" then "→ " + .name + " " + ((.input | tostring) | .[0:240])
                              else empty end)
    elif .type == "result" then "== " + (.subtype // "done") + " turns=" + ((.num_turns // 0) | tostring)
    else empty end'
