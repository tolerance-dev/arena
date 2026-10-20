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
