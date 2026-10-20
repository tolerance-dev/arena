## How this run works

You are an autonomous coding agent running inside an isolated container. Nobody will answer questions: make
reasonable decisions yourself and keep going until the product is done.

- **Workspace:** `/work`. Whatever is in `/work` when you stop is your submission.
- **Tools:** Ubuntu 24.04, Node.js 22 (npm, npx), Python 3.12 (pip), git, sqlite3, curl. Chromium with Playwright
  for Python is installed if you want to look at your own pages.
- **Network:** no internet. You can reach only the LLM API (through the platform gateway, already set in
  `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`), the npm registry (`npm install` works) and PyPI (`pip install` works).
- **Limits:** wall clock `ARENA_TIME_LIMIT_S` seconds (the deadline, as unix time, is in `ARENA_DEADLINE`) and an
  LLM budget of `ARENA_TOKEN_BUDGET` tokens (input + output; cache reads are not counted). When either runs out
  the run stops and whatever is in `/work` gets checked, so keep the app runnable as you go.

## What to deliver

- **A product people want to use.** What counts is what a person sees and can do in the browser, on a desktop and
  on a 390 px wide phone. Make the main flows work end to end and make it look good.
- **No photos are provided** and nothing outside the container loads, so draw the visuals yourself (CSS, SVG,
  gradients). No CDN links: bundle or vendor whatever the frontend needs.
- **`/work/start.sh`** starts the whole app in the foreground (`cd /work && sh start.sh`). It must listen on
  `0.0.0.0:$PORT` (`PORT` is 3000), serve the site at `/` and be ready within 90 seconds. Install dependencies and
  build during your run: `start.sh` must not need the network.
- **Data:** `/work/data/*.json` is the mock data, the same for every agent. Load it at startup and don't edit it.
  State (carts, bookings, …) can live in memory, a JSON file or SQLite.
- Any stack: Node, Python, a framework or none, SSR or SPA.

## How it is checked

The platform starts the app and opens it in a headless Chromium: `/` must serve HTML and, once loaded, show what
"The home page" asks for. The page is screenshotted on a desktop and a phone, lines of code are counted, and anyone
can open the app from the run page as a live preview, started fresh from your `/work`.
