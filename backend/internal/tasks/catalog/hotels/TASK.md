# Hotel booking

Build a hotel booking site in the spirit of Booking.com: people search hotels in a city for their dates, compare
them, look at rooms and book. Backend and frontend, both yours.

## The product

- **Search:** city, check-in and check-out dates, number of guests. Results show only hotels with at least one room
  that is free for the whole stay and fits the guests, with the lowest total price for the stay.
- **Results:** sort by price, rating, stars and distance to the centre; filter by stars and amenities.
- **Hotel page:** photos, description, amenities, address, rating, and every room type with its price per night,
  the total for the chosen dates and whether it is still available.
- **Booking:** a signed-in user books a room for the dates and guests. A room type has `inventory` identical rooms:
  on any night, the number of confirmed bookings of that room type can't exceed its inventory. Capacity limits the
  guests.
- **My bookings:** list with hotel, room, dates, total price, status; cancel a booking (it frees the room).
- **Sign in / sign out** with the users from `data/users.json`.

## Data (`/work/data`)

`hotels.json` (24 hotels in 6 cities), `rooms.json` (room types with `capacity`, `price_per_night` in EUR and
`inventory`), `bookings.json` (existing confirmed bookings: they occupy rooms), `users.json`.
Dates are ISO `YYYY-MM-DD`; a stay from `check_in` to `check_out` occupies the nights `check_in … check_out − 1`.

## API contract

These routes are checked automatically, exactly as written. Add any others you need.

| Route | Answer |
|---|---|
| `GET /api/hotels` | `{"items": [...], "total": <n>}`. Query: `city`, `check_in`, `check_out`, `guests`. Every item has the hotel fields and `min_total_price` (cheapest available room × nights) when dates are given. With dates, hotels with no fitting free room are left out. |
| `GET /api/hotels/{id}` | the hotel with `rooms`: each room type with its fields and, when `check_in`/`check_out` are given, `available` (number of free rooms for the whole stay) and `total_price`; 404 if unknown |
| `POST /api/login` | body `{"email", "password"}` → `{"token"}`; 401 on wrong credentials |
| `POST /api/bookings` | body `{"room_id", "check_in", "check_out", "guests"}` → 201 with the booking `{"id", "room_id", "hotel_id", "check_in", "check_out", "guests", "total_price", "status": "confirmed"}`; 409 when no room of that type is free; 400 on bad dates (check_out not after check_in, past dates) or too many guests; 401 without a token |
| `GET /api/bookings` | array of the signed-in user's bookings |
| `DELETE /api/bookings/{id}` | cancels the user's own booking (status `cancelled`, room freed); 404 for someone else's |
