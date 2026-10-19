# Judge checklist: Hotel booking

Test users: anna.novak@example.com / pass001, boris.berg@example.com / pass002 (see data/users.json).
The automatic checks already used greta.petrov@example.com (bookings in March 2027 at h2), leave her alone.
Known conflict in the data: room r4 at h2 (inventory 1) is booked 2026-12-01 … 2026-12-08.

## Functionality (60 points)
1. **Search UI (10):** city + dates + guests from the home page; results respect availability (search Lisbon for
   2026-12-02 … 2026-12-05 and check h2 does not offer r4); a family of 4 only sees hotels with a room for 4.
2. **Results (8):** price for the whole stay shown; sorting by price / rating / stars works; filters by stars and
   amenities work.
3. **Hotel page (8):** photos, amenities, address, rooms with price per night, total for the dates, availability.
4. **Sign in (5):** the UI signs in anna.novak, shows who is signed in, signs out; wrong password shows an error.
5. **Booking (14):** booking from the hotel page works end to end; the room's availability drops; booking the last
   free room twice for overlapping nights is refused (try with boris after anna); back-to-back stays are allowed;
   invalid dates and too many guests are refused with clear messages.
6. **My bookings and cancel (8):** list with hotel, room, dates, total; cancel frees the room (book it again).
7. **API hygiene (7):** 401 without a token; JSON errors with sensible statuses; bad input gives 400, not 500.

## UI and UX (25 points)
8. **Desktop (10):** looks like a real booking site: clear search, cards, readable prices and dates, loading and
   empty states ("no hotels for these dates").
9. **Mobile 390 px (10):** search, results, hotel page and booking are usable without horizontal scroll.
10. **Polish (5):** date pickers or clear date inputs, confirmation after booking, no console errors.

## Code (15 points)
11. **Structure (8):** availability logic in one place on the server, not trusted from the client; data loaded from
    /work/data including existing bookings.
12. **Quality (7):** validation, no race-prone double booking in obvious paths, passwords never returned, readable.
