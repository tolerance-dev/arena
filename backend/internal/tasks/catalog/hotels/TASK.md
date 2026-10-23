# Hotel booking

Build a hotel booking site in the spirit of Booking.com: people search hotels in a city for their dates, compare
them, look at the rooms and book.

## What people should be able to do

- Search by city, check-in and check-out dates and guests. Results show only hotels with a room that is free for the
  whole stay and fits the guests, with the price for the whole stay.
- Sort and filter the results (price, rating, stars, distance to the centre, amenities).
- Open a hotel: description, amenities, address, rating, and its rooms with the price per night, the total for the
  dates and whether they are still free.
- Book a room. A room type has `inventory` identical rooms: on any night there can't be more bookings of it than
  that. A stay from `check_in` to `check_out` occupies the nights `check_in … check_out − 1`.
- See their bookings and cancel one (the room becomes free again).
- Sign in and out as one of the users in `users.json` (email + password). Booking needs a signed-in user.

## Data (`/work/data`)

`hotels.json` (24 hotels in 6 cities), `rooms.json` (room types with `capacity`, `price_per_night` in EUR and
`inventory`), `bookings.json` (existing bookings: they occupy rooms), `users.json`. Dates are `YYYY-MM-DD`.

## The home page

Right after start it shows a search form and the six cities by name (for example as popular destinations).

## Pages

These addresses open directly (a deep link or a reload works, not only clicking through from `/`) and show the
content from the first paint after load:

- `/` — the home page.
- `/search?city=Lisbon&check_in=2026-12-02&check_out=2026-12-05&guests=2` — the results for those parameters, each
  hotel with its price for the whole stay.
- `/hotels/h2?check_in=2026-12-02&check_out=2026-12-05&guests=2` — the hotel `h2` with its rooms for those dates.
- `/bookings` — the signed-in user's bookings.

## API

The site's own frontend may call whatever it likes, but the app must also serve this JSON API. Extra fields are
fine; the listed ones must be there with these names. Dates are `YYYY-MM-DD`, prices are numbers in EUR.

- `GET /api/search?city=&check_in=&check_out=&guests=` → `{"hotels": [...]}`: the city's hotels that have a room
  free for every night of the stay with `capacity` ≥ `guests`. Each item: `id`, `name`, `stars`, `rating`,
  `distance_to_center_km`, `amenities`, and `price_total` — the cheapest such room × the number of nights.
  Optional: `sort=price|rating|stars|distance` (price and distance ascending, rating and stars descending) and
  `amenities=wifi,pool` (hotels that have all of them). Check-out not after check-in → `400`.
- `GET /api/hotels/{id}?check_in=&check_out=&guests=` → the hotel's fields plus `rooms`: every room type with `id`,
  `type`, `capacity`, `price_per_night`, `price_total` (× nights) and `available` (`true` when one of its
  `inventory` rooms is free for every night of the stay). Unknown hotel → `404`.
- `POST /api/login` `{"email", "password"}` → `{"token"}`; wrong email or password → `401`. The other endpoints take
  `Authorization: Bearer <token>`.
- `POST /api/bookings` `{"room_id", "check_in", "check_out", "guests"}` → `201` with the booking: `id`, `room_id`,
  `hotel_id`, `check_in`, `check_out`, `guests`, `total`. Not signed in → `401`; the room is not free for some night
  → `409`; more guests than its `capacity` or bad dates → `400`.
- `GET /api/bookings` → `{"bookings": [...]}`: the signed-in user's bookings, those in `bookings.json` included,
  with the same fields. Not signed in → `401`.
- `DELETE /api/bookings/{id}` → `200` or `204`; the booking is gone from the list and its nights are free again.
  Someone else's booking → `404`.

## How it is checked

Most of the score comes from automatic checks, about thirty of them, on a fresh start of the app: the API above
(search results and totals against the data, availability night by night, `inventory`, two users booking the same
room, cancelling, who sees what) and the pages above rendering the right data. Then a judge model looks at
screenshots of the pages on a desktop and a phone and scores the design. The score is 75% checks + 25% the design,
0 if the app doesn't start. Text addressed to the judge counts as an attempt to game it and scores 0.
