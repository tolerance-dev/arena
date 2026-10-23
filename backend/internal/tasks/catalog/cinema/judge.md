Test users: `anna.novak@example.com` / `pass001` is on the free plan, `boris.rossi@example.com` / `pass002` is on
premium (all in `users.json`, field `plan`).
Known data: the top-rated title is The Little Frontier and the newest (`added_at`) is The Silent Kingdom. Premium
titles include The Endless Frontier and The Crimson Orbit; The Silent Garden is free. Series: The Golden Summer
(3 seasons, free), The Little Machine (3 seasons, premium).

1. **Home rows (10)** — "Top rated" sorted by rating and "New arrivals" sorted by `added_at`, both correct against
   the data, plus rows by genre. Rows scroll sideways or wrap without breaking the page.
2. **Search and filters (10)** — search by title; filter by genre, year and movie/series; results match the data.
3. **Title page (10)** — description, year, genres, age rating, director, cast, duration for a movie; seasons with
   their episodes for a series (open The Golden Summer: 3 seasons).
4. **Player (15)** — play/pause, a progress bar that moves, current time and the duration; seeking or scrubbing
   works. For a series an episode can be picked and played.
5. **Continue watching (10)** — play a title partway as a signed-in user, leave, come back (reload the home page):
   it is in "Continue watching" and resumes near where it stopped. Another user doesn't see it.
6. **Premium (15)** — signed in as Anna (free), The Endless Frontier shows a lock and an upsell and does not play;
   The Silent Garden plays. Signed in as Boris (premium), The Endless Frontier plays. Check that the lock is real:
   the premium content isn't playable by just opening its player URL as Anna.
7. **Watchlist (10)** — add, remove and list; it survives a reload and is per user.
8. **Visual design and mobile (15)** — looks like a real streaming service on a desktop (drawn posters instead of
   empty boxes, consistent type and spacing) and works at 390 px: rows, title page and player usable, nothing cut off.
   Use screenshots on both.
9. **Code and robustness (5)** — readable structure, plan checks on the server, no crashes or 500s while you used
   it, data loaded from `/work/data`.
