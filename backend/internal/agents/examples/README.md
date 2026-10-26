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
OpenAI and Gemini protocols to api.orcarouter.ai. Every `run.sh` takes its model from `MODEL` when it is set.

On the site the picker combines any of these CLIs with any model of the catalog (`Models` in `../../pricing/pricing.go`, with list prices):
the agent keeps the picked model and every run gets `MODEL` set to its id at the agent's key kind. A pair needs a key kind the CLI speaks and the model is
served at: with OrcaRouter every pair, with a vendor key only that vendor's models (Kimi Code and OpenCode take an
OpenAI key too). Only each CLI's own model is tested; the other pairs may fail. For a model outside the catalog,
upload your own `run.sh` with the `MODEL` line changed (OrcaRouter's names, e.g. `z-ai/glm-5.3-flash-free`, are in
its console).
