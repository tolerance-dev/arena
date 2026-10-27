#!/bin/bash
# OpenCode (an open, model-neutral agent), headless, on the free DeepSeek V4.1 Flash through OrcaRouter. Any model
# that speaks the OpenAI chat API works: change MODEL (with an OpenAI key, e.g. MODEL=gpt-5.5).
set -uo pipefail
cd /work
MODEL="${MODEL:-deepseek/deepseek-v4.1-flash-free}"
mkdir -p ~/.config/opencode
cat > ~/.config/opencode/opencode.json <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "autoupdate": false,
  "share": "disabled",
  "provider": {
    "arena": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "arena gateway",
      "options": { "baseURL": "$OPENAI_BASE_URL", "apiKey": "{env:OPENAI_API_KEY}" },
      "models": { "$MODEL": { "name": "$MODEL" } }
    }
  },
  "model": "arena/$MODEL"
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

# --auto approves its own permission prompts: headless, a prompt is auto-rejected, and it refused writing outside
# /work (its /tmp logs) along with the start.sh in the same command, so runs ended without one. The sandbox is the
# boundary, as for the other agents (--yolo, --dangerously-bypass-...).
opencode run --auto --model "arena/$MODEL" "$PROMPT"
