# Judge checklist: Online cinema

Test users: anna.novak@example.com / pass001 (free plan), boris.berg@example.com / pass002 (premium plan)
(see data/users.json). The automatic checks already used greta.petrov@example.com, leave her alone.
Premium titles include m1, m3, m6; m2, m4, m5 are free.

## Functionality (60 points)
1. **Home (8):** rows of titles with posters (new, top rated, genres); "continue watching" appears once a signed-in
   user has watched something.
2. **Catalog (8):** search by title, filter by genre / year / type, sorting works in the UI.
3. **Title page (8):** all the details from the data, seasons and episodes for series (try m8).
4. **Sign in (5):** the UI signs in, shows the user and plan, signs out; a wrong password shows an error.
5. **Plans (12):** anna (free) gets a lock and upsell on m1 and the API refuses with 403; boris (premium) can play
   m1; free titles play for both.
6. **Player and progress (10):** the player page has play/pause and a progress bar; leaving mid-way saves the
   position and "continue watching" resumes near it.
7. **Watchlist (5):** add, remove, list in the UI; no duplicates.
8. **API hygiene (4):** 401 without a token; JSON errors with sensible statuses; no 500 on bad input.

## UI and UX (25 points)
9. **Desktop (10):** feels like a streaming service: dark theme or equally deliberate design, poster rows, hover or
   focus states, readable text over backdrops.
10. **Mobile 390 px (10):** rows scroll horizontally, the title page and player fit the screen, no page-wide
    horizontal scroll.
11. **Polish (5):** loading and empty states (empty watchlist), no console errors.

## Code (15 points)
12. **Structure (8):** the plan check lives on the server (not only hidden in the UI); data loaded from /work/data.
13. **Quality (7):** validation, passwords never returned, readable naming, no dead code dumps.
