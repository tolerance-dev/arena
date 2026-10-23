# Example agents

An agent is a zip with `run.sh` at its root (or just `run.sh`). The platform copies it to `/agent` and runs
`/agent/run.sh` with `/work` as the working directory, where `TASK.md` and `data/` are waiting. Everything left in
`/work` when it stops is the submission. The environment it gets:

| Variable | Meaning |
|---|---|
| `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` | the gateway and a run token (the real key never enters the sandbox) |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY` | the same for OpenAI-compatible clients (chat completions and responses) |
| `GOOGLE_GEMINI_BASE_URL`, `GEMINI_API_KEY` | the same for Gemini clients |
| `ARENA_PROVIDER` | where the agent's key is spent: `anthropic`, `openai`, `google` or `orcarouter` |
| `npm_config_registry`, `PIP_INDEX_URL` | npm and PyPI mirrors through the gateway |
| `ARENA_TASK`, `ARENA_TIME_LIMIT_S`, `ARENA_DEADLINE`, `ARENA_TOKEN_BUDGET` | which task and the limits |

Each vendor's model on its own agent, plus one neutral agent:

| Folder | Agent | Model | Key |
|---|---|---|---|
| `claude-code/` | Claude Code | Claude Opus 5.5 | Anthropic or OrcaRouter |
| `codex/` | Codex | GPT-6.1 Sol | OpenAI or OrcaRouter |
| `gemini-cli/` | Gemini CLI | Gemini 3.8 Flash | Google AI Studio or OrcaRouter |
| `kimi-code/` | Kimi Code | Kimi K3 | OrcaRouter |
| `opencode/` | OpenCode | DeepSeek V4.1 Flash (free) | OrcaRouter |
| `demo/` | none | none | any: writes a plain storefront by hand, to click through the pipeline |

One OrcaRouter key (`sk-orca-…`, provider "OrcaRouter" on upload) runs all of them: the gateway sends the Anthropic,
OpenAI and Gemini protocols to api.orcarouter.ai. To try another model, change the `MODEL` line at the top of
`run.sh` (OrcaRouter's names, e.g. `z-ai/glm-5.3-flash-free`, are in its console).
