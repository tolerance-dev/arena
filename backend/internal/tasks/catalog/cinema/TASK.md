# Online cinema

Build a streaming service in the spirit of Netflix: a catalog of films and series, a title page, a player, a
watchlist, "continue watching", and a premium plan that unlocks part of the catalog. Backend and frontend, both
yours.

## The product

- **Home:** rows of titles: new arrivals, top rated, by genre, and "continue watching" for a signed-in user.
- **Catalog:** search by title, filter by genre, year and type (movie / series), sort by rating, year, newest.
- **Title page:** backdrop, poster, description, year, genres, age rating, director, cast, duration, and seasons
  with episodes for series. A "Play" button and an "Add to watchlist" button.
- **Plans:** titles with `premium: true` play only for users on the `premium` plan (see `users.json` and
  `plans.json`); free users see a lock and an upsell instead of the player.
- **Player:** a player page for the title (the video itself is not provided: show a player with a poster frame,
  play/pause, a progress bar and the duration; it may simulate playback). Progress is saved to the server so the
  title appears in "continue watching" with how far the user got.
- **Watchlist:** add, remove, list.
- **Sign in / sign out** with the users from `data/users.json`.

## Data (`/work/data`)

`movies.json` (48 titles: movies and series; `stream_url` is a placeholder), `genres.json`, `plans.json`,
`users.json` (each with a `plan`).

## API contract

These routes are checked automatically, exactly as written. Add any others you need.

| Route | Answer |
|---|---|
| `GET /api/movies` | `{"items": [...], "total": <n>}`. Query: `q` (text in the title), `genre` (genre id), `type` (`movie` / `series`), `year`, `sort` (`rating`, `year`, `newest`), `page` (from 1), `limit` (default 20) |
| `GET /api/movies/{id}` | the title with at least the fields from `movies.json`; 404 if unknown |
| `GET /api/genres` | array of genres |
| `POST /api/login` | body `{"email", "password"}` → `{"token"}`; 401 on wrong credentials |
| `GET /api/me` | the signed-in user without the password, with `plan` |
| `GET /api/movies/{id}/play` | `{"stream_url"}` when the user may watch it; 403 for a premium title on the free plan; 401 without a token |
| `GET /api/watchlist` | array of titles in the user's watchlist |
| `POST /api/watchlist` | body `{"movie_id"}` adds (adding twice keeps one entry) |
| `DELETE /api/watchlist/{movie_id}` | removes |
| `POST /api/progress` | body `{"movie_id", "position_sec"}` saves where the user stopped |
| `GET /api/continue-watching` | array of `{"movie_id", "position_sec", ...}` for the user, most recent first |
