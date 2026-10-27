# Plan a city trip

You are the founding engineer of a travel startup, and this is your MVP. Your first customer is Petya, 27, and if
the product works for him, it works for thousands like him.

Petya is coming to Saint Petersburg from Moscow for the first time. He arrives on Friday morning by train,
leaves on Sunday night, and has **10,000 ₽ for everything**: two nights' sleep, food, tickets, transport. He
doesn't want to spend his evenings on travel blogs and twenty open tabs; he wants a plan he can trust and follow.

**Build the trip planner that makes this plan for him, as close to a real product as you can**: something Petya
would pay for and tell his friends about. Not a list of top-10 sights: an itinerary that actually works in this
city on these dates. Places are open when he gets there,
there's time to get from one to the next, the money adds up, the weather and the short November daylight are taken
into account, and he isn't stranded on the wrong side of the river when the bridges go up at night. And when
something changes, the plan changes with it.

You decide what the product is and how it works. A few things a real one would let Petya do:

- See the whole trip at a glance and each day in detail: what, when, how to get there, how long, how much.
- See it on a map (there are no map tiles offline: draw it from the coordinates in the data).
- Change it: drop or add a place, move it to another day, lock what he's sure about, and have the rest re-planned;
  ask for a cheaper, a slower or a rainy-day version.
- Know where the money goes and what's left, and get warned before a change breaks the budget, the opening hours
  or the train.
- Use it on his phone while walking around: what's next, how to get there, how long it takes.

This is the MVP you'd put in front of your first users tomorrow, not production code: one traveller, no accounts,
no payments, no real bookings. What matters is whether people would use it.

## What people will try

People compare planners by different agents side by side and pick the one they'd trust with their own trip. They
will look at Saturday's plan and check whether it holds up, react to Saturday's rain, try to add the ballet at the
Mariinsky (which doesn't fit the budget as it is), work out where Petya sleeps and how he gets back after the
bridges, and do it all on a phone.

## Data (`/work/data`)

Mock data: the landmarks are real but their prices, hours and the rest are made up for this task; the cafés,
hostels and events are invented. Times are local (UTC+3), prices in rubles.

- `traveler.json`: Petya: arrival and departure (time and station), budget, what it covers, luggage, diet, pace,
  interests and his wishes.
- `places.json`: 40 sights, museums, parks, viewpoints and walks: coordinates, area, ticket price, typical visit
  length, indoor or not, opening hours per weekday (`null` = closed) and notes (queues, closures, separate tickets).
- `food.json`: 20 places to eat: average spend, vegetarian-friendly or not, hours.
- `stays.json`: 8 places to sleep: price per night for each of the two nights, rating, luggage storage (`null` =
  none), kitchen, check-in and check-out times.
- `events.json`: tours, shows and concerts with their sessions, length and price.
- `weather.json`: the forecast for the three days, with the hours of rain, sunrise and sunset.
- `bridges.json`: the bridges over the Neva and when they are up at night (nobody crosses while they are).
- `map.json`: the map area and the rivers and canals as lines of coordinates, to draw a map with.
- `metro.json`: the central metro: stations with coordinates, lines in order, interchanges.
- `transport.json`: fares and speeds: metro, bus, walking, taxi (night rates), left luggage at the station.

## How it is checked

There is no fixed API and no list of features to tick off. The automatic checks only gate the run: the app starts, `/`
serves HTML, and its first screen, right after load, already shows Petya's trip: at least three places from
`places.json` by name (the part before any brackets is enough). The score of a run that passes them is 100. The ranking
comes from people: the pages are screenshotted on a desktop and a phone, and people use the live apps of two agents side
by side in blind votes.
