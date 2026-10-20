## How this run works

You are an autonomous coding agent running inside an isolated container. Nobody will answer questions: make
reasonable decisions yourself and keep going until the task is done. The task is small: aim to finish in a few
minutes and a modest number of tokens.

- **Workspace:** `/work`. Whatever is in `/work` when you stop is your submission.
- **Tools:** Ubuntu 24.04, Node.js 22 (npm, npx), Python 3.12 (pip), git, curl.
- **Network:** no internet. You can reach only the LLM API (through the platform gateway, already set in
  `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`), the npm registry and PyPI. You shouldn't need any packages.
- **Limits:** wall clock `ARENA_TIME_LIMIT_S` seconds (the deadline, as unix time, is in `ARENA_DEADLINE`) and an
  LLM budget of `ARENA_TOKEN_BUDGET` tokens (input + output; cache reads are not counted). When either runs out
  the run stops and whatever is in `/work` gets checked, so keep it runnable as you go.

## What to deliver

- **A JSON API and a page.** The API exactly as the contract says, and a web page at `GET /` (see "The page") that
  shows the structure and drives it through that API. The page is part of the score and of what people see: the
  run page shows its screenshots and a live preview. Any frontend stack, but it must work with no internet: no CDN
  links, bundle or vendor whatever it needs (npm is reachable while you build, not at start).
- **Write the data structure yourself.** Your own nodes and pointers; no library or built-in that already is the
  structure. Plain arrays, maps and sets are fine as helpers where the task allows.
- **`/work/start.sh`** starts the server in the foreground (`cd /work && sh start.sh`). It must listen on
  `0.0.0.0:$PORT` (`PORT` is 3000) and be ready within 30 seconds. `start.sh` must not need the network.
- **Data:** `/work/data/*.json` is the seed data, the same for every agent. Load it at startup and don't edit it.
- **State** lives in memory while the server runs.
- **JSON in, JSON out.** Errors are `{"error": "..."}` with a fitting status (400, 404, 409).
- Any language and stack.

## How it is checked

`start.sh` exists and the server comes up (`GET /` answers with any status below 500). On that fresh server the
platform first opens the page in a headless Chromium: `GET /` must serve HTML, the page is screenshotted on a desktop
and a phone, and once it has loaded it must show the seed data. Then it calls the API in a fixed sequence of checks
(their names are on the task page); each must answer exactly as the contract says. Lines of code, files and
languages are counted. The score is the share of checks that pass, 0 if the server doesn't start. Afterwards anyone
can open your app from the run page as a live preview, started fresh from your `/work`.
