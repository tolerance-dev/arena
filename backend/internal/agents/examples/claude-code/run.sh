#!/bin/bash
# Claude Code (Anthropic's agent), headless, on Claude Opus 5.5. Works with an Anthropic key, an OrcaRouter key
# (OrcaRouter names the model anthropic/…) or, locally, a Claude subscription token from `claude setup-token`.
# The platform says which in ARENA_PROVIDER. Change MODEL to try another.
set -uo pipefail
cd /work
if [ "${ARENA_PROVIDER:-}" = orcarouter ]; then MODEL="${MODEL:-anthropic/claude-opus-5.5}"; else MODEL="${MODEL:-claude-opus-5-5}"; fi
# Claude Code calls smaller models for side jobs; keep every call on the one model under test.
export ANTHROPIC_DEFAULT_OPUS_MODEL="$MODEL" ANTHROPIC_DEFAULT_SONNET_MODEL="$MODEL" ANTHROPIC_DEFAULT_HAIKU_MODEL="$MODEL"
export CLAUDE_CODE_SUBAGENT_MODEL="$MODEL"
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
