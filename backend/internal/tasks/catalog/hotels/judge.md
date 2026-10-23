Test users: `anna.novak@example.com` / `pass001` and `boris.rossi@example.com` / `pass002` (all in `users.json`).
Known data: Skyline Tower (`h2`, Lisbon) has a twin room (`r4`, capacity 2, 118 EUR/night, inventory 1) that is
fully booked for the nights 2026-12-01 … 2026-12-07 (booking `b-full`, check-out 2026-12-08); the same hotel has a
single (`r5`, inventory 1, 84 EUR), a family room (`r6`, capacity 4, inventory 2, 177 EUR) and a suite (`r7`,
capacity 3, 253 EUR). Use these dates and rooms to probe availability.

1. **Search (15)** — city, check-in, check-out and guests; results are the city's hotels that have a free room for
   the whole stay that fits the guests, each with the price for the whole stay. Lisbon 2026-12-02 → 2026-12-05 for 2
   guests: Skyline Tower appears (family and suite are free) with a correct total (for example 3 × 177 = 531 EUR for
   the family room). Invalid dates (check-out before check-in) are refused.
2. **Sort and filter (10)** — price, rating, stars, distance to the centre, amenities; the order and the filtering
   match the data.
3. **Hotel page (10)** — description, amenities, address, rating, stars, and every room type with its price per
   night, the total for the chosen dates and whether it is free. For Lisbon 2026-12-02 → 2026-12-05 the twin room is
   shown as not available.
4. **Availability rules (20)** — the core of the task; try each in the browser: booking the twin room for
   2026-12-07 → 2026-12-09 is refused (the night of the 7th is taken); 2026-12-08 → 2026-12-10 is allowed
   (check-out day is free). Book the single room for some dates as Anna, then as Boris try the same dates: refused.
   A room never takes more guests than its capacity.
5. **Bookings (10)** — after booking, the user's bookings list shows it with dates, room and total. Cancelling frees
   the room: after Anna cancels the single room, Boris can book those dates. Users see only their own bookings.
6. **Sign in and out (5)** — email + password from `users.json`; a wrong password is refused; booking asks to sign
   in when signed out.
7. **Visual design (15)** — looks like a real booking site on a desktop: clear search, readable result cards, drawn
   visuals instead of empty boxes, consistent spacing and type, no broken layout. Use screenshots.
8. **Mobile (10)** — at 390 px search, results, a hotel page and booking still work; date and guest inputs are
   usable; nothing is cut off.
9. **Code and robustness (5)** — readable structure, availability enforced on the server (not only in the page),
   no crashes or 500s while you used it, data loaded from `/work/data` including the existing bookings.
