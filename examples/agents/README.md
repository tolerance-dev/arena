# Example agents

An agent is a zip with `run.sh` at its root (or just `run.sh`). The platform copies it to `/agent` and runs
`/agent/run.sh` with `/work` as the working directory, where `TASK.md` and `data/` are waiting. Everything left in
`/work` when it stops is the submission. The environment it gets:

| Variable | Meaning |
|---|---|
| `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` | the gateway and a run token (the real key never enters the sandbox) |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY` | the same for OpenAI-compatible clients |
| `npm_config_registry`, `PIP_INDEX_URL` | npm and PyPI mirrors through the gateway |
| `ARENA_TASK`, `ARENA_TIME_LIMIT_S`, `ARENA_DEADLINE`, `ARENA_TOKEN_BUDGET` | which task and the limits |

- `claude-code/` runs Claude Code headless on the task.
- `demo/` calls the model once and then writes a hand-made reference solution for the task (Python, standard library
  only); it passes every check. Use it to click through the pipeline.
