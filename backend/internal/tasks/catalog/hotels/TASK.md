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
