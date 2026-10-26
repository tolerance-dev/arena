# Online cinema

Build a streaming service in the spirit of Netflix: a catalog of films and series, title pages, a player, a
watchlist and a premium plan.

## What people should be able to do

- Browse rows of titles on the home page: top rated, new arrivals, by genre, and "continue watching" once signed in.
- Search and filter the catalog (genre, year, movie or series).
- Open a title: description, year, genres, age rating, director, cast, duration, and seasons with episodes for a
  series.
- Play a title. There is no video: show a player with play/pause, a progress bar and the duration that simulates
  playback. Where the user stopped is saved, so the title shows up in "continue watching".
- Titles with `premium: true` play only for users on the premium plan; others see a lock and an upsell.
- Keep a watchlist: add, remove, list.
- Sign in and out as one of the users in `users.json` (email + password; each has a `plan`).

## Data (`/work/data`)

`movies.json` (48 titles), `genres.json`, `plans.json`, `users.json`.

## The home page

Right after start it shows a "Top rated" row (highest `rating` first) and a "New arrivals" row (latest `added_at`
first).

## Pages

These addresses open directly (a deep link or a reload works, not only clicking through from `/`) and show the
content from the first paint after load:

- `/` — the home page.
- `/titles/m2` — the title `m2`: its details and a way to play it.
- `/search?q=Harbor` — the titles matching the query.
- `/watchlist` — the signed-in user's watchlist.

## API

The site's own frontend may call whatever it likes, but the app must also serve this JSON API. Extra fields are
fine; the listed ones must be there with these names. A list item of a title has `id`, `title`, `type`, `year`,
`genres`, `rating`, `premium` and `added_at`.

- `GET /api/titles?q=&genre=&type=&sort=` → `{"titles": [...]}`: every title, or those whose `title` contains `q`
  (case-insensitive), that have the genre `genre`, of the `type` `movie` or `series`; filters combine. `sort=rating|year|added`
  orders by `rating`, `year` or `added_at`, highest or latest first.
- `GET /api/titles/{id}` → every field of the title in `movies.json` (`director`, `cast`, `duration_min`, `seasons`
  with their `episodes` …). Unknown title → `404`.
- `GET /api/home` → `{"top_rated": [...], "new_arrivals": [...]}`: the 10 titles with the highest `rating` and the 10
  latest by `added_at`, in that order. With a token also `continue_watching`: the titles the user saved progress on,
  the latest saved first, each with its `position_s`.
- `POST /api/login` `{"email", "password"}` → `{"token"}`; wrong email or password → `401`. The endpoints below take
  `Authorization: Bearer <token>`; without one → `401`.
- `GET /api/me` → `id`, `name`, `email`, `plan`.
- `GET /api/titles/{id}/play` → `{"title_id", "duration_s", "position_s"}`: the length in seconds (a movie's
  `duration_min` × 60; for a series the first episode's, or `?season=&episode=`) and where the user stopped (`0` if
  never). A `premium` title on a plan without premium → `403`; unknown title → `404`.
- `PUT /api/progress/{id}` `{"position_s"}` → `200` or `204`: saves where the user stopped. The same `403` as play;
  a position below 0 or past `duration_s` → `400`.
- `GET /api/watchlist` → `{"titles": [...]}`: the user's watchlist (empty at first).
- `PUT /api/watchlist/{id}` → `200`, `201` or `204`; adding a title twice keeps it once. Unknown title → `404`.
- `DELETE /api/watchlist/{id}` → `200` or `204`.

## How it is checked

The score is the share of automatic checks passed, about forty of them, on a fresh start of the app: the API above
(search, filters and sorting against the data, the home rows, premium titles for each plan, progress and "continue
watching", watchlists per user) and the pages above rendering the right data; 0 if the app doesn't start. The pages
are screenshotted on a desktop and a phone, and people compare apps built by different agents side by side in blind
votes.
