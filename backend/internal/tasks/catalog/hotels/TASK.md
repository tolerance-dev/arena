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

Right after start it shows a search form and the six cities by name (for example as popular destinations). The form
has the fields **City** (a text field or a list), **Check-in** and **Check-out** (date fields, or text fields that
take `YYYY-MM-DD`) and **Guests**, and a **Search** button that shows the results.

## Pages

These addresses open directly (a deep link or a reload works, not only clicking through from `/`) and show the
content from the first paint after load:

- `/` — the home page.
- `/search?city=Lisbon&check_in=2026-12-02&check_out=2026-12-05&guests=2` — the results for those parameters, each
  hotel with its price for the whole stay.
- `/hotels/h2?check_in=2026-12-02&check_out=2026-12-05&guests=2` — the hotel `h2` with its rooms for those dates.
- `/bookings` — the signed-in user's bookings, each with its hotel's name and a **Cancel** button (a cancelled
  booking leaves the list).

On a hotel page each free room has a **Book** button that books it for the dates in the address (a confirmation step is
fine). Every page has **Sign in** in its header (signed in: **Sign out**, there or in the account menu).

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

On a fresh start of the app, in this order:

1. About thirty checks of the API above (search results and totals against the data, availability night by night,
   `inventory`, two users booking the same room, cancelling, who sees what) and of the pages above rendering the
   right data.
2. A robot clicks through the main flows in a real browser (Chromium, 1280×800) like a person would, each step a
   check:
   - **Search**: on `/` it fills **City**, **Check-in**, **Check-out** and **Guests** and clicks **Search**: the hotels
     with a free room show up with their price for the stay, hotels of other cities don't.
   - **Sign in**: on `/` it clicks a **Sign in** (or **Log in**) button or link, fills the email and password fields of
     the form that opens (or of the page it leads to) and presses Enter. Then **Sign out** (or **Log out**) is there,
     also after a reload: on the page, or in the menu that a button with the user's name (or "Account") opens.
   - **Booking**: on `/hotels/{id}?check_in=…&check_out=…&guests=…` it clicks **Book** on a room (then **Confirm** if a
     confirmation shows up); the booking is in `/bookings` with the hotel's name; it clicks **Cancel** there (then
     **Yes** or **Confirm**), and after a reload the booking is gone.
   - **Sign out**: it clicks **Sign out**, and **Sign in** shows up again, also after a reload.

Buttons and links are found by their text or `aria-label` (case doesn't matter), fields by their label, placeholder,
`name` or `aria-label`; the robot waits a few seconds for each text to show up, accepts browser dialogs (`confirm`) and
signs in as a user of its own from `users.json`. A step that needs an earlier one (no cart without signing in) fails
with it.

The score is half the share of the API and page checks passed plus half the share of the browser checks passed; 0 if the
app doesn't start. The pages are screenshotted on a desktop and a phone, and people compare apps built by different
agents side by side in blind votes.
