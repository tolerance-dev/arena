"""Generates every task's data/*.json and task.json. Deterministic: python3 gen_data.py rewrites the same files.

task.json is generated: change titles, limits and the home-page strings (ui_text) here, not in the JSON.
The data has no image URLs on purpose: the sandbox has no internet, so the agents draw their own visuals.
"""
import json, random, os, datetime

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalog")
R = random.Random(20261019)
# A whole product (backend + frontend) in one go.
TIME_LIMIT_S = 1800
TOKEN_BUDGET = 2_000_000


def task_json(slug, order, title, tagline, ui_text, checks=(), **extra):
    # ui_text = strings the home page must show right after start. checks = HTTP and page checks run in order (see
    # verify.py); extra = judge_mode / judge_weight / pages for tasks judged on screenshots.
    obj = {"order": order, "title": title, "tagline": tagline, "time_limit_s": TIME_LIMIT_S,
           "token_budget": TOKEN_BUDGET, "ui": True, "ui_text": ui_text, **extra, "checks": list(checks)}
    with open(os.path.join(out, slug, "task.json"), "w") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")

def dump(task, name, obj):
    d = os.path.join(out, task, "data")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, name), "w") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")

FIRST = ["Anna", "Boris", "Clara", "David", "Elena", "Felix", "Greta", "Hugo", "Iris", "Jonas", "Kira", "Leo"]
LAST = ["Ivanova", "Petrov", "Smith", "Novak", "Garcia", "Muller", "Rossi", "Kowalski", "Berg", "Silva"]

def users(n, extra=None):
    res = []
    for i in range(1, n + 1):
        f, l = FIRST[(i - 1) % len(FIRST)], LAST[(i * 3) % len(LAST)]
        u = {"id": f"u{i}", "name": f"{f} {l}", "email": f"{f.lower()}.{l.lower()}@example.com", "password": f"pass{i:03d}"}
        if extra:
            u.update(extra(i))
        res.append(u)
    return res

# ---------- marketplace ----------
cats = [
    ("electronics", "Electronics", ["Wireless Earbuds", "Smart Watch", "Bluetooth Speaker", "USB-C Hub", "Mechanical Keyboard", "4K Monitor", "Webcam", "Power Bank", "Gaming Mouse", "Noise-Cancelling Headphones"]),
    ("home", "Home & Kitchen", ["Espresso Maker", "Cast Iron Skillet", "Chef Knife", "Air Fryer", "Linen Bedding Set", "Ceramic Mug Set", "Desk Lamp", "Electric Kettle", "Bamboo Cutting Board", "Scented Candle"]),
    ("fashion", "Fashion", ["Merino Sweater", "Denim Jacket", "Leather Sneakers", "Canvas Backpack", "Wool Scarf", "Rain Coat", "Chino Trousers", "Linen Shirt", "Leather Belt", "Baseball Cap"]),
    ("sports", "Sports & Outdoors", ["Yoga Mat", "Trail Running Shoes", "Insulated Bottle", "Camping Tent", "Resistance Bands", "Cycling Helmet", "Dumbbell Pair", "Hiking Poles", "Sleeping Bag", "Jump Rope"]),
    ("books", "Books", ["The Pragmatic Builder", "Designing Data Systems", "A Short History of Cities", "The Quiet Garden", "Learning to Cook", "Night Train to Lisbon", "Mountains of the Mind", "The Art of Tea", "Small Habits", "Stars and Atoms"]),
    ("toys", "Toys & Games", ["Wooden Puzzle", "Building Blocks Set", "Board Game: Harbors", "Plush Fox", "RC Car", "Card Game: Sprites", "Kite", "Science Kit", "Watercolor Set", "Marble Run"]),
]
brands = ["Northwind", "Acme", "Lumen", "Tidal", "Oakline", "Vertex", "Kestrel", "Polar", "Mosaic", "Juniper"]
sellers = [{"id": f"s{i}", "name": n, "rating": round(R.uniform(3.8, 5.0), 1)} for i, n in enumerate(["Gadget Garage", "Casa Bella", "Urban Thread", "Peak Outfitters", "Paper Lantern", "Little Wonders", "Daily Goods"], 1)]
products = []
pid = 0
for slug, cname, names in cats:
    for n in names:
        pid += 1
        price = round(R.choice([9, 14, 19, 24, 29, 39, 49, 59, 79, 99, 129, 149, 199, 249, 349]) + R.choice([0, 0.5, 0.99]), 2)
        stock = R.choice([0, 0, 1, 2, 3, 5, 8, 12, 20, 35, 50])
        products.append({
            "id": f"p{pid}",
            "title": f"{R.choice(brands)} {n}",
            "category": slug,
            "price": price,
            "currency": "USD",
            "old_price": round(price * R.choice([1.15, 1.25, 1.4]), 2) if R.random() < 0.25 else None,
            "rating": round(R.uniform(3.1, 5.0), 1),
            "reviews_count": R.randint(0, 2400),
            "stock": stock,
            "seller_id": R.choice(sellers)["id"],
            "description": f"{n} by {R.choice(brands)}. " + R.choice([
                "Built to last, designed for everyday use.",
                "A customer favourite with a clean, minimal look.",
                "Lightweight, durable and easy to care for.",
                "Thoughtfully made with premium materials.",
                "Great value and a two-year warranty.",
            ]),
            "tags": R.sample(["new", "bestseller", "eco", "gift", "sale", "limited"], R.randint(0, 2)),
        })
dump("marketplace", "categories.json", [{"id": s, "name": n} for s, n, _ in cats])
dump("marketplace", "products.json", products)
dump("marketplace", "sellers.json", sellers)
dump("marketplace", "users.json", users(8, lambda i: {"address": f"{10 + i} Market Street, Springfield"}))
reviews = []
for i in range(1, 121):
    p = R.choice(products)
    reviews.append({"id": f"r{i}", "product_id": p["id"], "user_id": f"u{R.randint(1, 8)}", "rating": R.randint(2, 5),
                    "text": R.choice(["Exactly as described.", "Fast delivery, works great.", "Good quality for the price.", "Would buy again.", "A bit smaller than expected.", "Love it!"]),
                    "created_at": f"2026-0{R.randint(1, 9)}-{R.randint(10, 28)}T12:00:00Z"})
dump("marketplace", "reviews.json", reviews)

# ---------- hotels ----------
cities = ["Lisbon", "Barcelona", "Prague", "Vienna", "Istanbul", "Tbilisi"]
hotel_names = ["Grand {c} Palace", "{c} Harbour Inn", "Old Town Suites", "Riverside Boutique", "The Lantern House", "Hostel Nomad", "Hotel Aurora", "Garden Court", "Skyline Tower", "Casa Azul", "The Orchard", "Stone Bridge Hotel"]
room_types = [("single", 1, 1.0), ("double", 2, 1.4), ("twin", 2, 1.4), ("family", 4, 2.1), ("suite", 3, 3.0)]
amen = ["wifi", "breakfast", "pool", "parking", "gym", "spa", "pets", "air_conditioning", "airport_shuttle", "kitchen"]
hotels, rooms = [], []
hid = rid = 0
for c in cities:
    for name in R.sample(hotel_names, 4):
        hid += 1
        stars = R.choice([2, 3, 3, 4, 4, 5])
        base = {2: 45, 3: 70, 4: 110, 5: 210}[stars] * R.uniform(0.85, 1.25)
        hotels.append({
            "id": f"h{hid}", "name": name.format(c=c), "city": c, "stars": stars,
            "rating": round(R.uniform(6.8, 9.7), 1), "reviews_count": R.randint(12, 3100),
            "address": f"{R.randint(1, 180)} {R.choice(['Main', 'River', 'Market', 'Castle', 'Harbour'])} Street, {c}",
            "distance_to_center_km": round(R.uniform(0.2, 7.5), 1),
            "amenities": sorted(R.sample(amen, R.randint(2, 6))),
            "description": R.choice(["Bright rooms a short walk from the old town.", "Quiet, friendly and great for families.", "Rooftop views and an excellent breakfast.", "Modern design in a historic building.", "Budget-friendly with everything you need."]),
            "check_in_from": "14:00", "check_out_until": "11:00",
            "free_cancellation_days": R.choice([0, 1, 3, 7]),
        })
        for t, cap, mult in R.sample(room_types, R.randint(2, 4)):
            rid += 1
            rooms.append({"id": f"r{rid}", "hotel_id": f"h{hid}", "type": t, "capacity": cap,
                          "price_per_night": round(base * mult), "currency": "EUR", "inventory": R.randint(1, 5),
                          "beds": {"single": "1 single", "double": "1 double", "twin": "2 singles", "family": "1 double + 2 singles", "suite": "1 king + sofa bed"}[t]})
dump("hotels", "hotels.json", hotels)
dump("hotels", "rooms.json", rooms)
hotel_users = users(8)
dump("hotels", "users.json", hotel_users)
bookings = []
start = datetime.date(2026, 11, 1)
for i in range(1, 61):
    r = R.choice(rooms)
    ci = start + datetime.timedelta(days=R.randint(0, 50))
    co = ci + datetime.timedelta(days=R.randint(1, 6))
    bookings.append({"id": f"b{i}", "room_id": r["id"], "hotel_id": r["hotel_id"], "user_id": f"u{R.randint(1, 8)}",
                     "check_in": ci.isoformat(), "check_out": co.isoformat(), "guests": R.randint(1, r["capacity"]), "status": "confirmed"})
# A fully booked room for the whole first week of December (a known conflict the judge can probe).
full = next(r for r in rooms if r["inventory"] == 1)
for k in range(1):
    bookings.append({"id": "b-full", "room_id": full["id"], "hotel_id": full["hotel_id"], "user_id": "u1",
                     "check_in": "2026-12-01", "check_out": "2026-12-08", "guests": 1, "status": "confirmed"})
dump("hotels", "bookings.json", bookings)

# ---------- hotels: the API checks ----------
# The expected answers are computed from the data, replaying the bookings the checks themselves make, so the
# checks stay right when the data is regenerated. They follow the API contract in hotels/TASK.md.
D = datetime.date.fromisoformat


def stay_nights(ci, co):
    return [(D(ci) + datetime.timedelta(days=k)).isoformat() for k in range((D(co) - D(ci)).days)]


def room_free(room, ci, co, bks):
    return all(sum(1 for b in bks if b["room_id"] == room["id"] and b["check_in"] <= n < b["check_out"]) < room["inventory"]
               for n in stay_nights(ci, co))


def search_ids(city, ci, co, guests, bks, amenities=()):
    """Hotel id → the cheapest total for the stay among its free rooms that fit the guests."""
    res = {}
    for h in hotels:
        if h["city"] != city or not set(amenities) <= set(h["amenities"]):
            continue
        totals = [r["price_per_night"] * len(stay_nights(ci, co)) for r in rooms
                  if r["hotel_id"] == h["id"] and r["capacity"] >= guests and room_free(r, ci, co, bks)]
        if totals:
            res[h["id"]] = min(totals)
    return res


def q(**kw):
    return "?" + "&".join(f"{k}={v}" for k, v in kw.items())


hc = []
def chk(name, method, path, **kw):
    hc.append({"name": name, "method": method, "path": path, **kw})

state = [b for b in bookings if b["status"] == "confirmed"]
by_id = {r["id"]: r for r in rooms}
twin, single, family = by_id["r4"], by_id["r5"], by_id["r6"]
assert full["id"] == twin["id"] and twin["inventory"] == 1 and single["inventory"] == 1 and family["inventory"] == 2
anna, boris = hotel_users[0], hotel_users[1]
S = dict(city="Lisbon", check_in="2026-12-02", check_out="2026-12-05", guests=2)
found = search_ids("Lisbon", "2026-12-02", "2026-12-05", 2, state)
assert found.get("h2") == 3 * family["price_per_night"]

# Pages: deep links render the data (in a real browser).
hc.append({"name": "search page lists the hotels with the price for the stay", "page": "/search" + q(**S),
           "text": ["Skyline Tower", str(found["h2"])]})
H = dict(check_in=S["check_in"], check_out=S["check_out"], guests=S["guests"])
hc.append({"name": "hotel page shows its rooms with the total", "page": "/hotels/h2" + q(**H),
           "text": ["Skyline Tower", "family", str(3 * family["price_per_night"])]})

# Search.
chk("search: hotels with a free room for the whole stay", "GET", "/api/search" + q(**S),
    expect=[{"path": "hotels", "ids": sorted(found)}])
chk("search: the price is the cheapest free room for the whole stay", "GET", "/api/search" + q(**S),
    expect=[{"path": "hotels[id=h2].price_total", "equals": found["h2"]}])
four = search_ids("Lisbon", "2026-12-02", "2026-12-05", 4, state)
chk("search: rooms must fit the guests", "GET", "/api/search" + q(**{**S, "guests": 4}),
    expect=[{"path": "hotels", "ids": sorted(four)}])
wifi = search_ids("Lisbon", "2026-12-02", "2026-12-05", 2, state, ["wifi"])
assert set(wifi) != set(found)
chk("search: filter by amenities", "GET", "/api/search" + q(**S, amenities="wifi"),
    expect=[{"path": "hotels", "ids": sorted(wifi)}])
for key, field in (("price", "price_total"), ("rating", "-rating"), ("stars", "-stars"), ("distance", "distance_to_center_km")):
    chk(f"search: sort by {key}", "GET", "/api/search" + q(**S, sort=key),
        expect=[{"path": "hotels", "len": len(found)}, {"path": "hotels", "sorted_by": field}])
chk("search: check-out before check-in is refused", "GET",
    "/api/search" + q(city="Lisbon", check_in="2026-12-05", check_out="2026-12-02", guests=2), status=400)

# Hotel page.
chk("hotel: a fully booked room is not available", "GET", "/api/hotels/h2" + q(**S),
    expect=[{"path": "rooms[id=r4].available", "equals": False}, {"path": "rooms[id=r6].available", "equals": True},
            {"path": "rooms[id=r6].price_total", "equals": 3 * family["price_per_night"]}])
chk("hotel: the check-out day is free", "GET", "/api/hotels/h2" + q(city="Lisbon", check_in="2026-12-08", check_out="2026-12-10", guests=2),
    expect=[{"path": "rooms[id=r4].available", "equals": True}])
chk("hotel: an unknown hotel is 404", "GET", "/api/hotels/h999", status=404)

# Sign in.
chk("sign in: a wrong password is refused", "POST", "/api/login", body={"email": anna["email"], "password": "wrong"}, status_in=[401, 403])
chk("sign in: Anna", "POST", "/api/login", body={"email": anna["email"], "password": anna["password"]},
    expect=[{"path": "token", "exists": True}], save={"anna": "token"})
chk("sign in: Boris", "POST", "/api/login", body={"email": boris["email"], "password": boris["password"]},
    expect=[{"path": "token", "exists": True}], save={"boris": "token"})
chk("booking needs a signed-in user", "POST", "/api/bookings",
    body={"room_id": "r6", "check_in": "2026-12-20", "check_out": "2026-12-22", "guests": 2}, status_in=[401, 403])


def book(name, who, room, ci, co, guests, ok, save=None):
    body = {"room_id": room["id"], "check_in": ci, "check_out": co, "guests": guests}
    if ok:
        assert room_free(room, ci, co, state) and guests <= room["capacity"]
        state.append({"id": save or name, "room_id": room["id"], "check_in": ci, "check_out": co, "user_id": who["id"]})
        total = room["price_per_night"] * len(stay_nights(ci, co))
        chk(name, "POST", "/api/bookings", auth=who["first"], body=body, status_in=[200, 201],
            expect=[{"path": "total", "equals": total}], **({"save": {save: "id"}} if save else {}))
    else:
        chk(name, "POST", "/api/bookings", auth=who["first"], body=body, status=409)


anna["first"], boris["first"] = "anna", "boris"
assert not room_free(twin, "2026-12-07", "2026-12-09", state)
book("availability: the night of the 7th is taken", anna, twin, "2026-12-07", "2026-12-09", 2, False)
book("availability: booking from the check-out day works", anna, twin, "2026-12-08", "2026-12-10", 2, True, "twin_booking")
chk("availability: more guests than the room takes are refused", "POST", "/api/bookings", auth="anna",
    body={"room_id": "r6", "check_in": "2026-12-20", "check_out": "2026-12-22", "guests": 5}, status_in=[400, 422])
book("availability: Anna books the single room", anna, single, "2026-12-20", "2026-12-22", 1, True, "single_booking")
book("availability: Boris can't book the same single room", boris, single, "2026-12-21", "2026-12-23", 1, False)
book("inventory: the first family room", boris, family, "2026-12-20", "2026-12-22", 4, True, "family_1")
book("inventory: the second family room", boris, family, "2026-12-20", "2026-12-22", 3, True, "family_2")
book("inventory: no third family room", anna, family, "2026-12-21", "2026-12-22", 2, False)
after = search_ids("Lisbon", "2026-12-20", "2026-12-22", 4, state)
assert "h2" not in after
chk("search: new bookings take rooms out of the results", "GET",
    "/api/search" + q(city="Lisbon", check_in="2026-12-20", check_out="2026-12-22", guests=4),
    expect=[{"path": "hotels", "ids": sorted(after)}])

# Bookings.
anna_seed = [b["id"] for b in bookings if b["user_id"] == anna["id"]]
chk("bookings: Anna sees her bookings, old and new", "GET", "/api/bookings", auth="anna",
    expect=[{"path": "bookings", "len": len(anna_seed) + 2}, {"path": "bookings[id=b-full]", "exists": True},
            {"path": "bookings[id={single_booking}].total", "equals": 2 * single["price_per_night"]}])
chk("bookings: Boris doesn't see Anna's", "GET", "/api/bookings", auth="boris",
    expect=[{"path": "bookings[id={single_booking}]", "absent": True}, {"path": "bookings[id={family_1}]", "exists": True}])
chk("bookings: a signed-out list is refused", "GET", "/api/bookings", status_in=[401, 403])
chk("cancel: Boris can't cancel Anna's booking", "DELETE", "/api/bookings/{single_booking}", auth="boris", status_in=[403, 404])
chk("cancel: Anna cancels the single room", "DELETE", "/api/bookings/{single_booking}", auth="anna", status_in=[200, 204])
state = [b for b in state if b["id"] != "single_booking"]
book("cancel: the cancelled dates are free again", boris, single, "2026-12-21", "2026-12-23", 1, True)
chk("cancel: the booking leaves Anna's list", "GET", "/api/bookings", auth="anna",
    expect=[{"path": "bookings[id={single_booking}]", "absent": True}, {"path": "bookings", "len": len(anna_seed) + 1}])
for u in (anna, boris):
    u.pop("first")

# ---------- cinema ----------
genres = ["drama", "comedy", "thriller", "sci-fi", "animation", "documentary", "romance", "adventure", "horror", "crime"]
words1 = ["Silent", "Last", "Golden", "Hidden", "Broken", "Northern", "Electric", "Midnight", "Paper", "Endless", "Crimson", "Little"]
words2 = ["Harbor", "Signal", "Garden", "Frontier", "Echo", "Kingdom", "Orbit", "River", "Machine", "Summer", "Winter", "Letters"]
directors = ["Mira Holm", "Jun Park", "Alba Ruiz", "Tomasz Wolny", "Ines Moreau", "Kofi Mensah", "Sara Lind", "Omar Haddad"]
actors = ["Lena Ford", "Max Ortega", "Yuki Tanaka", "Ravi Shah", "Nora Quinn", "Ethan Cole", "Zoe Adler", "Ivan Sokolov", "Ada Brooks", "Luca Bianchi", "Mei Chen", "Sam Okafor"]
movies = []
seen = set()
for i in range(1, 49):
    while True:
        t = f"The {R.choice(words1)} {R.choice(words2)}"
        if t not in seen:
            seen.add(t)
            break
    kind = "series" if i % 8 == 0 else "movie"
    m = {
        "id": f"m{i}", "title": t, "type": kind, "year": R.randint(1988, 2026),
        "genres": R.sample(genres, R.randint(1, 3)), "rating": round(R.uniform(5.2, 9.1), 1),
        "age_rating": R.choice(["0+", "6+", "12+", "16+", "18+"]),
        "duration_min": R.randint(82, 165) if kind == "movie" else None,
        "seasons": [{"number": s, "episodes": [{"number": e, "title": f"Episode {e}", "duration_min": R.randint(38, 58)} for e in range(1, R.randint(6, 10))]} for s in range(1, R.randint(2, 4))] if kind == "series" else None,
        "director": R.choice(directors), "cast": R.sample(actors, 3),
        "description": R.choice(["A quiet story about choices that echo for years.", "Two strangers race against time across a city that never sleeps.", "An unlikely team sets out to fix what everyone else gave up on.", "A coming-of-age tale told over one unforgettable summer.", "A gripping investigation that turns personal."]),
        "premium": R.random() < 0.35,
        "added_at": f"2026-{R.randint(1, 10):02d}-{R.randint(10, 28)}",
    }
    movies.append(m)
dump("cinema", "movies.json", movies)
dump("cinema", "genres.json", [{"id": g, "name": g.replace("-", " ").title()} for g in genres])
dump("cinema", "plans.json", [{"id": "free", "name": "Free", "price_month": 0, "includes_premium": False},
                               {"id": "premium", "name": "Premium", "price_month": 9.99, "includes_premium": True}])
dump("cinema", "users.json", users(8, lambda i: {"plan": "premium" if i % 2 == 0 else "free"}))

# ---------- task.json ----------
task_json("marketplace", 1, {"en": "Marketplace", "ru": "Маркетплейс"},
          {"en": "A storefront with many sellers: catalog, search, product pages, cart, checkout, orders.",
           "ru": "Витрина с продавцами: каталог, поиск, карточки товаров, корзина, оформление заказа, история."},
          [name for _, name, _ in cats])
task_json("hotels", 2, {"en": "Hotel booking", "ru": "Бронирование отелей"},
          {"en": "Booking.com in miniature: search by city and dates, hotel pages, rooms, bookings.",
           "ru": "Booking.com в миниатюре: поиск по городу и датам, страницы отелей, номера, брони."},
          cities, hc, judge_mode="screens", judge_weight=0.25,
          pages=["/", "/search" + q(**S), "/hotels/h2" + q(**H)])
top = max(movies, key=lambda m: (m["rating"], -int(m["id"][1:])))
newest = max(movies, key=lambda m: (m["added_at"], -int(m["id"][1:])))
assert sum(m["rating"] == top["rating"] for m in movies) == 1 and sum(m["added_at"] == newest["added_at"] for m in movies) == 1
task_json("cinema", 3, {"en": "Online cinema", "ru": "Онлайн-кинотеатр"},
          {"en": "Netflix in miniature: rows of titles, title pages, a player, a watchlist, a premium plan.",
           "ru": "Netflix в миниатюре: подборки, страница фильма, плеер, «смотреть позже», премиум."},
          [top["title"], newest["title"]])
print("ok", len(products), len(hotels), len(rooms), len(movies), "top", top["title"], "newest", newest["title"])
