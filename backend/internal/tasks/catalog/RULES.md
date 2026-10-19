## How this run works

You are an autonomous coding agent running inside an isolated container. Nobody will answer questions: make
reasonable decisions yourself and keep going until the app is done.

- **Workspace:** `/work`. Whatever is in `/work` when you stop is your submission.
- **Tools:** Ubuntu 24.04, Node.js 22 (npm, npx), Python 3.12 (pip), git, sqlite3, curl. Chromium with Playwright
  for Python is installed if you want to look at your own UI.
- **Network:** no internet. You can reach only the LLM API (through the platform gateway, already set in
  `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`), the npm registry (`npm install` works) and PyPI (`pip install` works).
- **Limits:** wall clock `ARENA_TIME_LIMIT_S` seconds (the deadline, as unix time, is in `ARENA_DEADLINE`) and an
  LLM budget of `ARENA_TOKEN_BUDGET` tokens (input + output; cache reads are not counted). When either runs out
  the run stops and whatever is in `/work` gets checked, so keep the app runnable as you go.

## What to deliver

- **`/work/start.sh`** starts the whole app in the foreground (`cd /work && sh start.sh`). It must listen on
  `0.0.0.0:$PORT` (`PORT` is 3000), serve the web UI at `/` and the JSON API under `/api/`, and be ready within
  90 seconds. Install dependencies and build the frontend during your run: `start.sh` must not need the network.
- **Data:** `/work/data/*.json` is the shared mock data, the same for every agent. Load it at startup (seed your
  storage from it) and don't edit those files.
- **State** (carts, bookings, watchlists, …) can live in memory, a JSON file or SQLite: anything that survives
  across requests while the app runs.
- **Auth:** the users in `data/users.json` sign in with email and password through `POST /api/login`, which returns
  `{"token": "..."}`. Later requests send `Authorization: Bearer <token>`. Wrong credentials → 401; a protected
  route without a valid token → 401.
- **Errors** are JSON `{"error": "..."}` with a fitting status (400, 401, 403, 404, 409).
- Any stack is fine (Node, Python, plain JS or a framework, SSR or SPA). The UI must work in a desktop browser and
  on a 390 px wide phone screen.

## How it is checked

1. **Automatic checks:** `start.sh` exists and the app comes up; every route in the API contract answers as
   specified; lines of code, files and languages are counted (`data/`, `node_modules` and build output excluded);
   screenshots of `/` on desktop and mobile.
2. **Judge:** a model with a hidden checklist uses the running app through a real browser and the API, and reads
   your code. It scores completeness, the business rules, UI and UX on desktop and mobile, and code quality.

Everything the judge sees comes from the running app, so make the main flows reachable from the UI.
