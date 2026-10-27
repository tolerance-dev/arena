"""Generates every task's data/*.json and task.json. Deterministic: python3 gen_data.py rewrites the same files.

task.json is generated: change titles, limits and the home-page strings (ui_text) here, not in the JSON.
The data has no image URLs on purpose: the sandbox has no internet, so the agents draw their own visuals.

python3 gen_data.py --hidden DIR [--seed N] also writes DIR/<slug>/checks.json, the hidden checks for
ARENA_TASKS_HIDDEN_DIR: the same kinds of checks on other records (categories, products, users, cities, dates,
titles), picked at random. This repo is public, so the secret is which records: keep DIR out of git (deploy/README.md).
"""
import argparse, json, random, os, datetime

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalog")
R = random.Random(20261019)
# A whole product (backend + frontend) in one go.
TIME_LIMIT_S = 1800
TOKEN_BUDGET = 2_000_000


def task_json(slug, order, title, tagline, ui_text, checks=(), kind="build", scenarios=()):
    # ui_text = strings the home page must show right after start. checks = HTTP and page checks run in order (see
    # verify.py); the score is the share of them passed. kind: "build" = to a spec, ranked by the checks; "invent"
    # (rethink a known product) and "startup" (an MVP for one person's real problem) = the agent designs the product,
    # the checks only gate it and people's votes rank it, trying the scenarios.
    obj = {"order": order, "kind": kind, "title": title, "tagline": tagline, "time_limit_s": TIME_LIMIT_S,
           "token_budget": TOKEN_BUDGET, "ui": True, "ui_text": ui_text, "checks": list(checks)}
    if scenarios:
        obj["scenarios"] = list(scenarios)
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
# u9 is the browser scenarios' own user (BROWSER_USER): no seed records, and the hidden checks pick from u3..u8.
BROWSER_USER = 9
market_users = users(BROWSER_USER, lambda i: {"address": f"{10 + i} Market Street, Springfield"})
dump("marketplace", "users.json", market_users)
reviews = []
for i in range(1, 121):
    p = R.choice(products)
    reviews.append({"id": f"r{i}", "product_id": p["id"], "user_id": f"u{R.randint(1, 8)}", "rating": R.randint(2, 5),
                    "text": R.choice(["Exactly as described.", "Fast delivery, works great.", "Good quality for the price.", "Would buy again.", "A bit smaller than expected.", "Love it!"]),
                    "created_at": f"2026-0{R.randint(1, 9)}-{R.randint(10, 28)}T12:00:00Z"})
dump("marketplace", "reviews.json", reviews)

# ---------- marketplace: the API checks ----------
# Computed from the data, with no randomness (the hotels and cinema data after this must not move), and prefixed m_
# (the names are module-global). They follow the API contract in marketplace/TASK.md; the cart and stock scenario
# replays what the checks themselves buy.
mc = []
def mchk(name, method, path, **kw):
    mc.append({"name": name, "method": method, "path": path, **kw})

m_prod = {p["id"]: p for p in products}
m_seller = {x["id"]: x for x in sellers}
def m_money(v):
    return round(v, 2)
def m_titled(q, cat=None):
    return sorted(p["id"] for p in products if q.lower() in p["title"].lower() and (cat is None or p["category"] == cat))

m_hit = m_titled("set")
assert len(m_hit) >= 3
m_p = m_prod["p40"]
m_reviews = [r for r in reviews if r["product_id"] == "p40"]
assert len(m_reviews) >= 3
mc.append({"name": "search page lists the matching products with their prices", "page": "/search?q=set",
           "text": [m_prod[i]["title"] for i in m_hit] + [str(m_prod[m_hit[0]]["price"])]})
mc.append({"name": "product page shows the product, its seller and reviews", "page": "/products/p40",
           "text": [m_p["title"], str(m_p["price"]), m_seller[m_p["seller_id"]]["name"], m_reviews[0]["text"]]})

mchk("catalog: every product", "GET", "/api/products", expect=[{"path": "products", "len": len(products)}])
mchk("catalog: filter by category", "GET", "/api/products?category=books",
     expect=[{"path": "products", "ids": sorted(p["id"] for p in products if p["category"] == "books")}])
mchk("catalog: search the titles, any case", "GET", "/api/products?q=SeT", expect=[{"path": "products", "ids": m_hit}])
m_both = m_titled("set", "toys")
assert 0 < len(m_both) < len(m_hit)
mchk("catalog: search within a category", "GET", "/api/products?q=set&category=toys", expect=[{"path": "products", "ids": m_both}])
for key, field in (("price", "price"), ("price_desc", "-price"), ("rating", "-rating")):
    mchk(f"catalog: sort by {key}", "GET", f"/api/products?sort={key}",
         expect=[{"path": "products", "len": len(products)}, {"path": "products", "sorted_by": field}])
mchk("product: price, stock and seller", "GET", "/api/products/p40",
     expect=[{"path": "price", "equals": m_p["price"]}, {"path": "stock", "equals": m_p["stock"]},
             {"path": "seller.name", "equals": m_seller[m_p["seller_id"]]["name"]}])
mchk("product: its reviews", "GET", "/api/products/p40", expect=[{"path": "reviews", "ids": sorted(r["id"] for r in m_reviews)}])
mchk("product: an unknown product is 404", "GET", "/api/products/p999", status=404)

m_anna, m_boris = market_users[0], market_users[1]
mchk("sign in: a wrong password is refused", "POST", "/api/login", body={"email": m_anna["email"], "password": "wrong"}, status_in=[401, 403])
mchk("sign in: Anna", "POST", "/api/login", body={"email": m_anna["email"], "password": m_anna["password"]},
     expect=[{"path": "token", "exists": True}], save={"anna": "token"})
mchk("sign in: Boris", "POST", "/api/login", body={"email": m_boris["email"], "password": m_boris["password"]},
     expect=[{"path": "token", "exists": True}], save={"boris": "token"})
mchk("cart: needs a signed-in user", "GET", "/api/cart", status_in=[401, 403])

# m_a: plenty in stock; m_b: exactly 2 left; m_sold: sold out; m_last: one left, which both users want.
m_a = next(p for p in products if p["stock"] >= 5)
m_b = next(p for p in products if p["stock"] == 2)
m_sold = next(p for p in products if p["stock"] == 0)
m_last = next(p for p in products if p["stock"] == 1)
def m_put(name, who, p, n, **kw):
    mchk(name, "POST", "/api/cart", auth=who, body={"product_id": p["id"], "quantity": n}, **kw)

m_put("cart: add two of a product", "anna", m_a, 2,
      expect=[{"path": f"items[product_id={m_a['id']}].subtotal", "equals": m_money(2 * m_a["price"])},
              {"path": "total", "equals": m_money(2 * m_a["price"])}])
m_put("cart: a second product adds to the total", "anna", m_b, 2,
      expect=[{"path": "items", "len": 2}, {"path": "total", "equals": m_money(2 * m_a["price"] + 2 * m_b["price"])}])
m_put("cart: no more than the stock", "anna", m_b, 3, status=409)
m_put("cart: a sold-out product can't be added", "anna", m_sold, 1, status=409)
m_put("cart: an unknown product is 404", "anna", {"id": "p999"}, 1, status=404)
m_put("cart: a negative quantity is refused", "anna", m_a, -1, status_in=[400, 422])
m_put("cart: changing a quantity", "anna", m_a, 1,
      expect=[{"path": f"items[product_id={m_a['id']}].quantity", "equals": 1},
              {"path": "total", "equals": m_money(m_a["price"] + 2 * m_b["price"])}])
m_put("cart: quantity 0 removes the product", "anna", m_b, 0,
      expect=[{"path": "items", "len": 1}, {"path": f"items[product_id={m_b['id']}]", "absent": True}])
mchk("cart: every user has their own", "GET", "/api/cart", auth="boris", expect=[{"path": "items", "len": 0}])
m_put("last item: Anna puts it in her cart", "anna", m_last, 1, status_in=[200, 201])
m_put("last item: so does Boris", "boris", m_last, 1, status_in=[200, 201])
mchk("checkout: Anna's order", "POST", "/api/orders", auth="anna", status_in=[200, 201],
     expect=[{"path": "total", "equals": m_money(m_a["price"] + m_last["price"])}, {"path": "items", "len": 2}], save={"order1": "id"})
mchk("checkout: the cart is empty afterwards", "GET", "/api/cart", auth="anna", expect=[{"path": "items", "len": 0}])
mchk("checkout: the stock goes down", "GET", f"/api/products/{m_a['id']}", expect=[{"path": "stock", "equals": m_a["stock"] - 1}])
mchk("last item: Boris can't check out what is gone", "POST", "/api/orders", auth="boris", status=409)
mchk("last item: his failed checkout ordered nothing", "GET", "/api/orders", auth="boris", expect=[{"path": "orders", "len": 0}])
mchk("last item: the catalog shows it sold out", "GET", "/api/products?category=" + m_last["category"],
     expect=[{"path": f"products[id={m_last['id']}].stock", "equals": 0}])
m_put("last item: it can't go into a cart any more", "anna", m_last, 1, status=409)
mchk("checkout: an empty cart is refused", "POST", "/api/orders", auth="anna", status_in=[400, 409, 422])
m_put("checkout: Anna takes the last two of a product", "anna", m_b, 2, status_in=[200, 201])
mchk("checkout: Anna's second order", "POST", "/api/orders", auth="anna", status_in=[200, 201],
     expect=[{"path": "total", "equals": m_money(2 * m_b["price"])}], save={"order2": "id"})
mchk("orders: Anna sees both", "GET", "/api/orders", auth="anna",
     expect=[{"path": "orders", "len": 2}, {"path": "orders[id={order1}].total", "equals": m_money(m_a["price"] + m_last["price"])},
             {"path": "orders[id={order2}]", "exists": True}])
mchk("orders: Boris doesn't see Anna's", "GET", "/api/orders", auth="boris", expect=[{"path": "orders[id={order1}]", "absent": True}])
mchk("orders: a signed-out list is refused", "GET", "/api/orders", status_in=[401, 403])

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
hotel_users = users(BROWSER_USER)
dump("hotels", "users.json", hotel_users)
bookings = []
start = datetime.date(2026, 11, 1)
for i in range(1, 61):
    r = R.choice(rooms)
    ci = start + datetime.timedelta(days=R.randint(0, 50))
    co = ci + datetime.timedelta(days=R.randint(1, 6))
    bookings.append({"id": f"b{i}", "room_id": r["id"], "hotel_id": r["hotel_id"], "user_id": f"u{R.randint(1, 8)}",
                     "check_in": ci.isoformat(), "check_out": co.isoformat(), "guests": R.randint(1, r["capacity"]), "status": "confirmed"})
# A fully booked room for the whole first week of December (a known conflict the checks probe).
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
cinema_users = users(BROWSER_USER, lambda i: {"plan": "premium" if i % 2 == 0 else "free"})
dump("cinema", "users.json", cinema_users)

# ---------- cinema: the API checks ----------
# Computed from the data, like the hotels checks; they follow the API contract in cinema/TASK.md. No randomness
# here (R is not touched), so regenerating keeps the data.
cc = []
def cchk(name, method, path, **kw):
    cc.append({"name": name, "method": method, "path": path, **kw})

mv = {m["id"]: m for m in movies}
def title_ids(pred):
    return sorted(m["id"] for m in movies if pred(m))

def top_n(key, n=10):
    ranked = sorted(movies, key=key, reverse=True)
    assert key(ranked[n - 1]) != key(ranked[n]), "a tie at the boundary makes the row ambiguous"
    return ranked[:n]

free_u, prem_u = cinema_users[0], cinema_users[1]
assert free_u["plan"] == "free" and prem_u["plan"] == "premium"
free_movies = [m for m in movies if m["type"] == "movie" and not m["premium"]]
prem_movie = next(m for m in movies if m["type"] == "movie" and m["premium"])
fm1, fm2 = free_movies[0], free_movies[1]
series = next(m for m in movies if m["type"] == "series")
word = next(w for w in words2 if 2 <= sum(w in m["title"] for m in movies) <= 4)
by_word = title_ids(lambda m: word.lower() in m["title"].lower())
genre = "comedy"
by_genre = title_ids(lambda m: genre in m["genres"])
all_series = title_ids(lambda m: m["type"] == "series")
both_genre = next(g for g in genres if 0 < len(title_ids(lambda m: g in m["genres"] and m["type"] == "series")) < len(all_series))
both = title_ids(lambda m: both_genre in m["genres"] and m["type"] == "series")
rated, added = top_n(lambda m: m["rating"]), top_n(lambda m: m["added_at"])

# Pages: deep links render the data (in a real browser).
cc.append({"name": "title page shows the title with its director and year", "page": f"/titles/{fm1['id']}",
           "text": [fm1["title"], fm1["director"], str(fm1["year"])]})
cc.append({"name": "search page lists the matching titles", "page": f"/search?q={word}",
           "text": [mv[i]["title"] for i in by_word]})

# Catalog.
cchk("catalog: every title", "GET", "/api/titles", expect=[{"path": "titles", "len": len(movies)}])
cchk("catalog: search by title", "GET", f"/api/titles?q={word}", expect=[{"path": "titles", "ids": by_word}])
cchk("catalog: search ignores case", "GET", f"/api/titles?q={word.lower()}", expect=[{"path": "titles", "ids": by_word}])
cchk("catalog: filter by genre", "GET", f"/api/titles?genre={genre}", expect=[{"path": "titles", "ids": by_genre}])
cchk("catalog: series only", "GET", "/api/titles?type=series", expect=[{"path": "titles", "ids": all_series}])
cchk("catalog: genre and type together", "GET", f"/api/titles?genre={both_genre}&type=series", expect=[{"path": "titles", "ids": both}])
cchk("catalog: sort by rating", "GET", "/api/titles?sort=rating",
     expect=[{"path": "titles", "len": len(movies)}, {"path": "titles", "sorted_by": "-rating"}])
cchk("catalog: sort by year", "GET", "/api/titles?sort=year",
     expect=[{"path": "titles", "len": len(movies)}, {"path": "titles", "sorted_by": "-year"}])
cchk("catalog: sort by date added", "GET", "/api/titles?sort=added",
     expect=[{"path": "titles.0.id", "equals": added[0]["id"]}, {"path": "titles.1.id", "equals": added[1]["id"]}])
cchk("title: a movie with its details", "GET", f"/api/titles/{fm1['id']}",
     expect=[{"path": "director", "equals": fm1["director"]}, {"path": "cast", "equals": fm1["cast"]},
             {"path": "duration_min", "equals": fm1["duration_min"]}])
cchk("title: a series with seasons and episodes", "GET", f"/api/titles/{series['id']}",
     expect=[{"path": "seasons", "len": len(series["seasons"])},
             {"path": "seasons.0.episodes", "len": len(series["seasons"][0]["episodes"])}])
cchk("title: an unknown title is 404", "GET", "/api/titles/m999", status=404)
cchk("home: top rated, highest first", "GET", "/api/home",
     expect=[{"path": "top_rated", "ids": [m["id"] for m in rated]}, {"path": "top_rated", "sorted_by": "-rating"}])
cchk("home: new arrivals, latest first", "GET", "/api/home",
     expect=[{"path": "new_arrivals", "ids": [m["id"] for m in added]}, {"path": "new_arrivals.0.id", "equals": added[0]["id"]}])

# Sign in and plans.
cchk("sign in: a wrong password is refused", "POST", "/api/login", body={"email": free_u["email"], "password": "wrong"}, status_in=[401, 403])
cchk("sign in: a free user", "POST", "/api/login", body={"email": free_u["email"], "password": free_u["password"]},
     expect=[{"path": "token", "exists": True}], save={"free": "token"})
cchk("sign in: a premium user", "POST", "/api/login", body={"email": prem_u["email"], "password": prem_u["password"]},
     expect=[{"path": "token", "exists": True}], save={"prem": "token"})
cchk("me: the signed-in user's plan", "GET", "/api/me", auth="free", expect=[{"path": "plan", "equals": "free"}])
cchk("me: signed out is refused", "GET", "/api/me", status_in=[401, 403])

# Playback and premium.
cchk("play: needs a signed-in user", "GET", f"/api/titles/{fm1['id']}/play", status_in=[401, 403])
cchk("play: a free title plays from the start", "GET", f"/api/titles/{fm1['id']}/play", auth="free",
     expect=[{"path": "duration_s", "equals": fm1["duration_min"] * 60}, {"path": "position_s", "equals": 0}])
cchk("premium: a free plan can't play a premium title", "GET", f"/api/titles/{prem_movie['id']}/play", auth="free", status=403)
cchk("premium: the premium plan plays it", "GET", f"/api/titles/{prem_movie['id']}/play", auth="prem",
     expect=[{"path": "duration_s", "equals": prem_movie["duration_min"] * 60}])
cchk("progress: saving where the user stopped", "PUT", f"/api/progress/{fm1['id']}", auth="free",
     body={"position_s": 600}, status_in=[200, 201, 204])
cchk("progress: play resumes from it", "GET", f"/api/titles/{fm1['id']}/play", auth="free",
     expect=[{"path": "position_s", "equals": 600}])
cchk("progress: past the end is refused", "PUT", f"/api/progress/{fm2['id']}", auth="free",
     body={"position_s": fm2["duration_min"] * 60 + 1}, status_in=[400, 422])
cchk("premium: a free plan can't save progress on a premium title", "PUT", f"/api/progress/{prem_movie['id']}", auth="free",
     body={"position_s": 60}, status=403)
cchk("progress: a second title", "PUT", f"/api/progress/{fm2['id']}", auth="free", body={"position_s": 120}, status_in=[200, 201, 204])
cchk("continue watching: the latest first, with the position", "GET", "/api/home", auth="free",
     expect=[{"path": "continue_watching", "ids": [fm1["id"], fm2["id"]]}, {"path": "continue_watching.0.id", "equals": fm2["id"]},
             {"path": f"continue_watching[id={fm1['id']}].position_s", "equals": 600}])
cchk("continue watching: someone else's is not shown", "GET", "/api/home", auth="prem",
     expect=[{"path": f"continue_watching[id={fm1['id']}]", "absent": True}])

# Watchlist.
cchk("watchlist: needs a signed-in user", "GET", "/api/watchlist", status_in=[401, 403])
cchk("watchlist: add a title", "PUT", f"/api/watchlist/{fm1['id']}", auth="prem", status_in=[200, 201, 204])
cchk("watchlist: add a series", "PUT", f"/api/watchlist/{series['id']}", auth="prem", status_in=[200, 201, 204])
cchk("watchlist: adding twice keeps one", "PUT", f"/api/watchlist/{fm1['id']}", auth="prem", status_in=[200, 201, 204])
cchk("watchlist: an unknown title is 404", "PUT", "/api/watchlist/m999", auth="prem", status=404)
cchk("watchlist: lists what was added", "GET", "/api/watchlist", auth="prem",
     expect=[{"path": "titles", "ids": sorted([fm1["id"], series["id"]])}])
cchk("watchlist: another user's is separate", "GET", "/api/watchlist", auth="free", expect=[{"path": "titles", "len": 0}])
cchk("watchlist: remove a title", "DELETE", f"/api/watchlist/{fm1['id']}", auth="prem", status_in=[200, 204])
cchk("watchlist: the removed title is gone", "GET", "/api/watchlist", auth="prem", expect=[{"path": "titles", "ids": [series["id"]]}])

# ---------- the browser scenarios ----------
# The main flows clicked through in a real browser, after the API checks and before the hidden ones (verify.py runs
# them). Each check is a few steps in one browser context per flow; a check that needs what an earlier one gave
# (signin, cart …) fails without running when that one failed. The labels they look for are in each TASK.md. They
# sign in as u9 (BROWSER_USER) and touch only records the hidden checks never do: the product m_a, the Lisbon hotels
# in January 2027, a cinema user's own list.
SIGN_IN = r"\b(sign|log)\s*-?\s*in\b"  # a button or link, by its text or aria-label
SIGN_OUT = r"\b(sign|log)\s*-?\s*out\b"


def bchk(name, flow, steps, needs=(), gives=None):
    b = {"flow": flow, "steps": steps}
    if needs:
        b["needs"] = list(needs)
    if gives:
        b["gives"] = gives
    return {"name": "browser: " + name, "browser": b}


def account_menu(u):
    """A button that may open the account menu, where Sign out often is: the user's name or initials, "Account" …"""
    first, last = u["name"].split()
    return rf"^\W*{first[0]}{last[0]}\W*$|\b{first}\b|{u['email'].split('@')[0]}|account|profile|user|avatar|menu"


def b_sign_in(u):
    menu = account_menu(u)
    return [bchk("sign in with email and password, Enter submits", "account",
                 [{"goto": "/"}, {"signin": {"email": u["email"], "password": u["password"]}}, {"control": SIGN_OUT, "menu": menu}],
                 gives="signin"),
            bchk("still signed in after a reload", "account", [{"reload": True}, {"control": SIGN_OUT, "menu": menu}], needs=["signin"])]


def b_sign_out(u):
    # Signed out = Sign in shows up again (Sign out may have been in a menu, so its absence alone says little).
    return bchk("sign out", "account", [{"click": SIGN_OUT, "menu": account_menu(u)}, {"control": SIGN_IN},
                                         {"reload": True}, {"control": SIGN_IN}, {"no_control": SIGN_OUT}], needs=["signin"])


def b_search(name, path, text, want, unwanted):
    return bchk(name, "search", [{"goto": path}, {"fill": r"search", "css": "input[type=search]", "value": text, "key": "Enter", "open": r"search"},
                                 {"expect": want}, {"absent": unwanted}])


# Marketplace: search, then u9 buys two of m_a and checks the order.
mu = market_users[BROWSER_USER - 1]
m_word = m_a["title"].split()[-1]
assert m_titled(m_word) == [m_a["id"]]
m_other = next(p for p in products if p["category"] == m_a["category"] and p["id"] != m_a["id"])
m_bc = [b_search("the search box finds products", "/", m_word.lower(), [m_a["title"]], [m_other["title"]])] + b_sign_in(mu) + [
    bchk("Add to cart on the product page puts it in /cart", "account",
         [{"goto": f"/products/{m_a['id']}"}, {"click": r"add to (cart|bag|basket)"}, {"goto": "/cart"}, {"expect": [m_a["title"]]}],
         needs=["signin"], gives="cart"),
    bchk("a new quantity in /cart updates the total", "account",
         [{"fill": r"quantity|qty", "css": "input[type=number]", "value": "2", "key": "Tab", "or_click": r"^\s*\+\s*$|increase|plus"},
          {"expect": [f"{2 * m_a['price']:g}"]}], needs=["cart"]),
    bchk("Checkout places the order, shown in /orders", "account",
         [{"click": r"check\s*-?\s*out|place (the |your )?order"}, {"click": r"^\W*(confirm|place (the |your )?order|pay)\b", "optional": True},
          {"goto": "/orders"}, {"expect": [m_a["title"]]}], needs=["cart"], gives="order"),
    bchk("the cart is empty after checkout", "account", [{"goto": "/cart"}, {"absent": [m_a["title"]]}], needs=["order"]),
    b_sign_out(mu),
    bchk("signed out, /orders shows no orders", "account", [{"goto": "/orders"}, {"absent": [m_a["title"]]}], needs=["order", "signin"]),
]
mc += m_bc

# Hotels: the home search form for Lisbon in January 2027 (no bookings then), then u9 books a room of Garden Court and
# cancels it.
hu = hotel_users[BROWSER_USER - 1]
JAN = dict(check_in="2027-01-12", check_out="2027-01-15")
assert all(b["check_out"] < JAN["check_in"] for b in state)
h_found = search_ids("Lisbon", JAN["check_in"], JAN["check_out"], 2, state)
h_names = {h["id"]: h["name"] for h in hotels}
h_book = next(h for h in hotels if h["name"] == "Garden Court")
assert h_book["city"] == "Lisbon" and all(r["capacity"] >= 2 for r in rooms if r["hotel_id"] == h_book["id"])  # any room fits 2 guests
lisbon = [h["name"] for h in hotels if h["city"] == "Lisbon"]
h_elsewhere = next(h for h in hotels if h["city"] != "Lisbon" and all(h["name"] not in n and n not in h["name"] for n in lisbon))
h_bc = [
    bchk("the home search form finds hotels for the dates", "search",
         [{"goto": "/"}, {"fill": r"city|destination|where", "value": "Lisbon"},
          {"fill": r"check.?in|arriv", "value": JAN["check_in"]}, {"fill": r"check.?out|depart", "value": JAN["check_out"]},
          {"fill": r"guest|people|adult|travell?er", "value": "2"}, {"click": r"^\W*(search|find)\b"},
          {"expect": [h_names[i] for i in sorted(h_found)] + [str(h_found[h_book["id"]])]},
          {"absent": [h_elsewhere["name"]]}]),
    *b_sign_in(hu),
    bchk("Book on a room of the hotel page books it, shown in /bookings", "account",
         [{"goto": f"/hotels/{h_book['id']}" + q(**JAN, guests=2)}, {"click": r"^\W*(book|reserve)\b"},
          {"click": r"^\W*(confirm|complete)\b", "optional": True}, {"goto": "/bookings"}, {"expect": [h_book["name"]]}],
         needs=["signin"], gives="booking"),
    bchk("Cancel in /bookings cancels it", "account",
         [{"click": r"^\W*cancel\b"}, {"click": r"^\W*(yes|confirm)\b", "optional": True}, {"wait": 1},
          {"reload": True}, {"absent": [h_book["name"]]}], needs=["booking"]),
    b_sign_out(hu),
]
hc += h_bc

# Cinema: the search box, then u9 puts a title in My list and takes it off.
cu = cinema_users[BROWSER_USER - 1]
c_word = next(w for w in words1 if w != word and 2 <= len(title_ids(lambda m: w in m["title"])) <= 3)
c_hits = title_ids(lambda m: c_word in m["title"])
c_other = next(m for m in rated if c_word not in m["title"])
c_title = next(m for m in movies if m["type"] == "movie" and not m["premium"] and m["id"] not in (fm1["id"], fm2["id"])
               and sum(m["title"] in x["title"] for x in movies) == 1)
c_bc = [b_search("the search box finds titles", "/", c_word.lower(), [mv[i]["title"] for i in c_hits], [c_other["title"]]),
        *b_sign_in(cu),
        bchk("My list on a title page adds it to /watchlist", "account",
             [{"goto": f"/titles/{c_title['id']}"}, {"click": r"my list|watch\s*list|watch later"}, {"wait": 1},
              {"goto": "/watchlist"}, {"expect": [c_title["title"]]}], needs=["signin"], gives="watchlist"),
        bchk("Remove in /watchlist takes it off", "account",
             [{"click": r"^\W*remove\b"}, {"wait": 1}, {"reload": True}, {"absent": [c_title["title"]]}], needs=["watchlist"]),
        b_sign_out(cu)]
cc += c_bc

# ---------- task.json ----------
task_json("marketplace", 1, {"en": "Marketplace", "ru": "Маркетплейс"},
          {"en": "A storefront with many sellers: catalog, search, product pages, cart, checkout, orders.",
           "ru": "Витрина с продавцами: каталог, поиск, карточки товаров, корзина, оформление заказа, история."},
          [name for _, name, _ in cats], mc)
task_json("hotels", 2, {"en": "Hotel booking", "ru": "Бронирование отелей"},
          {"en": "Booking.com in miniature: search by city and dates, hotel pages, rooms, bookings.",
           "ru": "Booking.com в миниатюре: поиск по городу и датам, страницы отелей, номера, брони."},
          cities, hc)
top = max(movies, key=lambda m: (m["rating"], -int(m["id"][1:])))
newest = max(movies, key=lambda m: (m["added_at"], -int(m["id"][1:])))
assert sum(m["rating"] == top["rating"] for m in movies) == 1 and sum(m["added_at"] == newest["added_at"] for m in movies) == 1
task_json("cinema", 3, {"en": "Online cinema", "ru": "Онлайн-кинотеатр"},
          {"en": "Netflix in miniature: rows of titles, title pages, a player, a watchlist, a premium plan.",
           "ru": "Netflix в миниатюре: подборки, страница фильма, плеер, «смотреть позже», премиум."},
          [top["title"], newest["title"]], cc)
print("ok", len(products), len(hotels), len(rooms), len(movies), "top", top["title"], "newest", newest["title"])

# ---------- the voted tasks: invent and startup (gen_invent.py) ----------
import gen_invent
print("voted", *gen_invent.generate(out, task_json))


# ---------- hidden checks ----------
# Run after the public checks on the state they leave (verify.py, in one go). They use other users and records than
# the public ones where they change state, and replay the state they change themselves. HR picks the records: a
# fresh seed each time unless --seed is given; R (the data) is not touched.

def hidden_market(HR):
    hc = []
    def add(name, method, path, **kw):
        hc.append({"name": name, "method": method, "path": path, **kw})
    stock = {p["id"]: p["stock"] for p in products}
    stock[m_a["id"]] -= 3  # one bought by the API checks, two by the browser scenario
    stock[m_last["id"]] = stock[m_b["id"]] = 0
    touched = {m_a["id"], m_b["id"], m_last["id"], m_sold["id"], "p40"}
    free = [p for p in products if p["id"] not in touched]

    cat = HR.choice([c for c, _, _ in cats if c != "books"])
    add("catalog: filter by category", "GET", f"/api/products?category={cat}",
        expect=[{"path": "products", "ids": sorted(p["id"] for p in products if p["category"] == cat)}])
    words = sorted({w for p in products for w in p["title"].split() if len(w) >= 4})
    word = HR.choice([w for w in words if 2 <= len(m_titled(w)) <= 10])
    add("catalog: search the titles, any case", "GET", f"/api/products?q={word.swapcase()}",
        expect=[{"path": "products", "ids": m_titled(word)}])
    brand = HR.choice([b for b in brands if len({m_prod[i]["category"] for i in m_titled(b)}) >= 2])
    bcat = HR.choice(sorted({m_prod[i]["category"] for i in m_titled(brand)}))
    add("catalog: search within a category", "GET", f"/api/products?q={brand.lower()}&category={bcat}",
        expect=[{"path": "products", "ids": m_titled(brand, bcat)}])
    scat, (skey, sfield) = HR.choice([c for c, _, _ in cats]), HR.choice([("price", "price"), ("price_desc", "-price"), ("rating", "-rating")])
    add("catalog: sort within a category", "GET", f"/api/products?category={scat}&sort={skey}",
        expect=[{"path": "products", "len": sum(p["category"] == scat for p in products)}, {"path": "products", "sorted_by": sfield}])
    p = HR.choice([p for p in free if any(r["product_id"] == p["id"] for r in reviews)])
    add("product: price, stock and seller", "GET", f"/api/products/{p['id']}",
        expect=[{"path": "price", "equals": p["price"]}, {"path": "stock", "equals": stock[p["id"]]},
                {"path": "seller.name", "equals": m_seller[p["seller_id"]]["name"]},
                {"path": "reviews", "ids": sorted(r["id"] for r in reviews if r["product_id"] == p["id"])}])
    add("product: an unknown product is 404", "GET", f"/api/products/p{HR.randint(100, 9999)}", status=404)
    hc.append({"name": "product page shows the product and its seller", "page": f"/products/{p['id']}",
               "text": [p["title"], str(p["price"]), m_seller[p["seller_id"]]["name"]]})
    hc.append({"name": "search page lists the matching products", "page": f"/search?q={word.lower()}",
               "text": [m_prod[i]["title"] for i in m_titled(word)]})

    x, y = HR.sample(market_users[2:8], 2)
    add("sign in: a wrong password is refused", "POST", "/api/login", body={"email": x["email"], "password": x["password"] + "x"}, status_in=[401, 403])
    for k, u in (("h_x", x), ("h_y", y)):
        add("sign in", "POST", "/api/login", body={"email": u["email"], "password": u["password"]},
            expect=[{"path": "token", "exists": True}], save={k: "token"})
    a = HR.choice([p for p in free if stock[p["id"]] >= 3])
    b = HR.choice([p for p in free if 1 <= stock[p["id"]] <= 8 and p["id"] != a["id"]])
    na = HR.randint(2, 3)
    add("cart: add a product", "POST", "/api/cart", auth="h_x", body={"product_id": a["id"], "quantity": na},
        expect=[{"path": f"items[product_id={a['id']}].subtotal", "equals": m_money(na * a["price"])},
                {"path": "total", "equals": m_money(na * a["price"])}])
    add("cart: no more than the stock", "POST", "/api/cart", auth="h_x", body={"product_id": b["id"], "quantity": stock[b["id"]] + 1}, status=409)
    nb = stock[b["id"]]
    add("cart: all that is left", "POST", "/api/cart", auth="h_x", body={"product_id": b["id"], "quantity": nb},
        expect=[{"path": "items", "len": 2}, {"path": "total", "equals": m_money(na * a["price"] + nb * b["price"])}])
    add("cart: a fractional quantity is refused", "POST", "/api/cart", auth="h_x", body={"product_id": a["id"], "quantity": 1.5}, status_in=[400, 422])
    add("cart: every user has their own", "GET", "/api/cart", auth="h_y", expect=[{"path": "items", "len": 0}])
    add("checkout: the order", "POST", "/api/orders", auth="h_x", status_in=[200, 201],
        expect=[{"path": "total", "equals": m_money(na * a["price"] + nb * b["price"])}, {"path": "items", "len": 2}], save={"h_order": "id"})
    stock[a["id"]] -= na
    stock[b["id"]] = 0
    add("checkout: the stock goes down", "GET", f"/api/products/{a['id']}", expect=[{"path": "stock", "equals": stock[a["id"]]}])
    add("checkout: the catalog shows the bought-out product sold out", "GET", f"/api/products?category={b['category']}",
        expect=[{"path": f"products[id={b['id']}].stock", "equals": 0}])
    add("cart: a bought-out product can't be added", "POST", "/api/cart", auth="h_y", body={"product_id": b["id"], "quantity": 1}, status=409)
    sold = HR.choice([p for p in free if stock[p["id"]] == 0 and p["id"] != b["id"]])
    add("cart: a sold-out product can't be added", "POST", "/api/cart", auth="h_y", body={"product_id": sold["id"], "quantity": 1}, status=409)
    add("orders: the buyer sees the order", "GET", "/api/orders", auth="h_x",
        expect=[{"path": "orders", "len": 1}, {"path": "orders[id={h_order}].total", "equals": m_money(na * a["price"] + nb * b["price"])}])
    add("orders: another user doesn't", "GET", "/api/orders", auth="h_y", expect=[{"path": "orders", "len": 0}])
    return hc


def hidden_hotels(HR):
    hc = []
    def add(name, method, path, **kw):
        hc.append({"name": name, "method": method, "path": path, **kw})
    st = list(state)  # after the public checks (all in Lisbon, so other cities are as in the data)
    day0 = datetime.date(2026, 11, 1)
    def stay():
        ci = day0 + datetime.timedelta(days=HR.randint(0, 55))
        return ci.isoformat(), (ci + datetime.timedelta(days=HR.randint(2, 5))).isoformat()

    for _ in range(1000):
        city = HR.choice(cities[1:])
        ci, co = stay()
        g = HR.randint(1, 3)
        found = search_ids(city, ci, co, g, st)
        more = search_ids(city, ci, co, g + 2, st)
        ams = [am for am in amen if search_ids(city, ci, co, g, st, [am]) and set(search_ids(city, ci, co, g, st, [am])) != set(found)]
        if len(found) >= 2 and ams:
            break
    S = dict(city=city, check_in=ci, check_out=co, guests=g)
    add("search: hotels with a free room for the whole stay", "GET", "/api/search" + q(**S), expect=[{"path": "hotels", "ids": sorted(found)}])
    h = HR.choice(sorted(found))
    add("search: the price is the cheapest free room for the whole stay", "GET", "/api/search" + q(**S),
        expect=[{"path": f"hotels[id={h}].price_total", "equals": found[h]}])
    add("search: rooms must fit the guests", "GET", "/api/search" + q(**{**S, "guests": g + 2}), expect=[{"path": "hotels", "ids": sorted(more)}])
    am = HR.choice(ams)
    add("search: filter by amenities", "GET", "/api/search" + q(**S, amenities=am),
        expect=[{"path": "hotels", "ids": sorted(search_ids(city, ci, co, g, st, [am]))}])
    key, field = HR.choice([("price", "price_total"), ("rating", "-rating"), ("stars", "-stars"), ("distance", "distance_to_center_km")])
    add("search: sort", "GET", "/api/search" + q(**S, sort=key), expect=[{"path": "hotels", "len": len(found)}, {"path": "hotels", "sorted_by": field}])
    hotel = next(x for x in hotels if x["id"] == h)
    hc.append({"name": "search page lists the hotels with the price for the stay", "page": "/search" + q(**S), "text": [hotel["name"], str(found[h])]})

    # A seed booking that fills a room: the room is taken on its nights and free from its check-out day.
    nights = lambda ci, co: (D(co) - D(ci)).days
    plus2 = lambda d: (D(d) + datetime.timedelta(days=2)).isoformat()
    sb = HR.choice([b for b in bookings if b["hotel_id"] not in ("h1", "h2", "h3", "h4") and by_id[b["room_id"]]["inventory"] == 1
                    and not room_free(by_id[b["room_id"]], b["check_in"], b["check_out"], st)
                    and room_free(by_id[b["room_id"]], b["check_out"], plus2(b["check_out"]), st)])
    room = by_id[sb["room_id"]]
    H = dict(check_in=sb["check_in"], check_out=sb["check_out"], guests=1)
    add("hotel: a booked room is not available", "GET", f"/api/hotels/{room['hotel_id']}" + q(**H),
        expect=[{"path": f"rooms[id={room['id']}].available", "equals": False},
                {"path": f"rooms[id={room['id']}].price_total", "equals": room["price_per_night"] * nights(sb["check_in"], sb["check_out"])}])
    add("hotel: the check-out day is free", "GET", f"/api/hotels/{room['hotel_id']}" + q(check_in=sb["check_out"], check_out=plus2(sb["check_out"]), guests=1),
        expect=[{"path": f"rooms[id={room['id']}].available", "equals": True}])
    add("hotel: an unknown hotel is 404", "GET", f"/api/hotels/h{HR.randint(100, 9999)}", status=404)

    x, y = HR.sample(hotel_users[2:8], 2)
    add("sign in: a wrong password is refused", "POST", "/api/login", body={"email": x["email"], "password": x["password"] + "x"}, status_in=[401, 403])
    for k, u in (("h_x", x), ("h_y", y)):
        add("sign in", "POST", "/api/login", body={"email": u["email"], "password": u["password"]},
            expect=[{"path": "token", "exists": True}], save={k: "token"})
    # x books a single-inventory room in another city; y can't overlap it but can start on its check-out day.
    for _ in range(1000):
        r = HR.choice([r for r in rooms if r["inventory"] == 1 and r["hotel_id"] not in ("h1", "h2", "h3", "h4")])
        bci, bco = stay()
        nxt = plus2(bco)
        if room_free(r, bci, nxt, st):
            break
    rh = next(x for x in hotels if x["id"] == r["hotel_id"])
    total = r["price_per_night"] * nights(bci, bco)
    add("booking: a free room", "POST", "/api/bookings", auth="h_x",
        body={"room_id": r["id"], "check_in": bci, "check_out": bco, "guests": r["capacity"]}, status_in=[200, 201],
        expect=[{"path": "total", "equals": total}, {"path": "hotel_id", "equals": r["hotel_id"]}], save={"h_b": "id"})
    st.append({"id": "h_b", "room_id": r["id"], "check_in": bci, "check_out": bco, "user_id": x["id"]})
    mid = (D(bci) + datetime.timedelta(days=1)).isoformat()
    add("availability: an overlapping stay is refused", "POST", "/api/bookings", auth="h_y",
        body={"room_id": r["id"], "check_in": mid, "check_out": nxt, "guests": 1}, status=409)
    add("availability: more guests than the room takes are refused", "POST", "/api/bookings", auth="h_y",
        body={"room_id": r["id"], "check_in": bco, "check_out": nxt, "guests": r["capacity"] + 1}, status_in=[400, 422])
    add("availability: check-out before check-in is refused", "POST", "/api/bookings", auth="h_y",
        body={"room_id": r["id"], "check_in": nxt, "check_out": bco, "guests": 1}, status_in=[400, 422])
    add("availability: booking from the check-out day works", "POST", "/api/bookings", auth="h_y",
        body={"room_id": r["id"], "check_in": bco, "check_out": nxt, "guests": 1}, status_in=[200, 201],
        expect=[{"path": "total", "equals": r["price_per_night"] * 2}])
    add("hotel: the booked room is not available", "GET", f"/api/hotels/{r['hotel_id']}" + q(check_in=bci, check_out=bco, guests=1),
        expect=[{"path": f"rooms[id={r['id']}].available", "equals": False}])
    hc.append({"name": "hotel page shows its rooms with the total", "page": f"/hotels/{r['hotel_id']}" + q(check_in=bci, check_out=bco, guests=1),
               "text": [rh["name"], r["type"], str(total)]})
    seed_x = [b["id"] for b in bookings if b["user_id"] == x["id"]]
    add("bookings: the user sees theirs, old and new", "GET", "/api/bookings", auth="h_x",
        expect=[{"path": "bookings", "len": len(seed_x) + 1}, {"path": "bookings[id={h_b}].total", "equals": total}]
        + ([{"path": f"bookings[id={seed_x[0]}]", "exists": True}] if seed_x else []))
    add("bookings: another user doesn't see them", "GET", "/api/bookings", auth="h_y", expect=[{"path": "bookings[id={h_b}]", "absent": True}])
    add("cancel: not someone else's booking", "DELETE", "/api/bookings/{h_b}", auth="h_y", status_in=[403, 404])
    add("cancel: the owner cancels", "DELETE", "/api/bookings/{h_b}", auth="h_x", status_in=[200, 204])
    add("cancel: the nights are free again", "GET", f"/api/hotels/{r['hotel_id']}" + q(check_in=bci, check_out=bco, guests=1),
        expect=[{"path": f"rooms[id={r['id']}].available", "equals": True}])
    add("cancel: the booking leaves the list", "GET", "/api/bookings", auth="h_x",
        expect=[{"path": "bookings[id={h_b}]", "absent": True}, {"path": "bookings", "len": len(seed_x)}])
    return hc


def hidden_cinema(HR):
    hc = []
    def add(name, method, path, **kw):
        hc.append({"name": name, "method": method, "path": path, **kw})
    w = HR.choice([w for w in words1 + words2 if w != word and 2 <= len(title_ids(lambda m: w.lower() in m["title"].lower())) <= 6])
    hits = title_ids(lambda m: w.lower() in m["title"].lower())
    add("catalog: search by title, any case", "GET", f"/api/titles?q={w.swapcase()}", expect=[{"path": "titles", "ids": hits}])
    g = HR.choice([x for x in genres if x != genre])
    add("catalog: filter by genre", "GET", f"/api/titles?genre={g}", expect=[{"path": "titles", "ids": title_ids(lambda m: g in m["genres"])}])
    add("catalog: genre and movies only", "GET", f"/api/titles?genre={g}&type=movie",
        expect=[{"path": "titles", "ids": title_ids(lambda m: g in m["genres"] and m["type"] == "movie")}])
    key, field = HR.choice([("rating", "-rating"), ("year", "-year")])
    add("catalog: filter and sort", "GET", f"/api/titles?genre={g}&sort={key}",
        expect=[{"path": "titles", "len": len(title_ids(lambda m: g in m["genres"]))}, {"path": "titles", "sorted_by": field}])
    m = HR.choice([m for m in movies if m["type"] == "movie" and m["id"] != fm1["id"]])
    add("title: a movie with its details", "GET", f"/api/titles/{m['id']}",
        expect=[{"path": "director", "equals": m["director"]}, {"path": "cast", "equals": m["cast"]},
                {"path": "duration_min", "equals": m["duration_min"]}, {"path": "year", "equals": m["year"]}])
    s = HR.choice([m for m in movies if m["type"] == "series"])
    add("title: a series with seasons and episodes", "GET", f"/api/titles/{s['id']}",
        expect=[{"path": "seasons", "len": len(s["seasons"])}, {"path": f"seasons.{len(s['seasons']) - 1}.episodes", "len": len(s["seasons"][-1]["episodes"])}])
    add("title: an unknown title is 404", "GET", f"/api/titles/m{HR.randint(100, 9999)}", status=404)
    hc.append({"name": "title page shows the title with its director and year", "page": f"/titles/{m['id']}", "text": [m["title"], m["director"], str(m["year"])]})
    hc.append({"name": "search page lists the matching titles", "page": f"/search?q={w}", "text": [mv[i]["title"] for i in hits]})

    x = HR.choice([u for u in cinema_users[2:8] if u["plan"] == "free"])
    y = HR.choice([u for u in cinema_users[2:8] if u["plan"] == "premium"])
    add("sign in: a wrong password is refused", "POST", "/api/login", body={"email": y["email"], "password": y["password"] + "x"}, status_in=[401, 403])
    for k, u in (("h_x", x), ("h_y", y)):
        add("sign in", "POST", "/api/login", body={"email": u["email"], "password": u["password"]},
            expect=[{"path": "token", "exists": True}], save={k: "token"})
    add("me: the signed-in user", "GET", "/api/me", auth="h_y", expect=[{"path": "plan", "equals": "premium"}, {"path": "email", "equals": y["email"]}])
    pm = HR.choice([m for m in movies if m["type"] == "movie" and m["premium"] and m["id"] != prem_movie["id"]])
    add("premium: a free plan can't play a premium title", "GET", f"/api/titles/{pm['id']}/play", auth="h_x", status=403)
    add("premium: the premium plan plays it", "GET", f"/api/titles/{pm['id']}/play", auth="h_y",
        expect=[{"path": "duration_s", "equals": pm["duration_min"] * 60}, {"path": "position_s", "equals": 0}])
    sn = HR.randint(1, len(s["seasons"]))
    ep = HR.choice(s["seasons"][sn - 1]["episodes"])
    add("play: a series episode", "GET", f"/api/titles/{s['id']}/play?season={sn}&episode={ep['number']}", auth="h_y",
        expect=[{"path": "duration_s", "equals": ep["duration_min"] * 60}])
    a, b = HR.sample([m for m in free_movies if m["id"] not in (fm1["id"], fm2["id"])], 2)
    pa = HR.randint(1, a["duration_min"] * 60 - 1)
    add("progress: saving where the user stopped", "PUT", f"/api/progress/{a['id']}", auth="h_x", body={"position_s": pa}, status_in=[200, 201, 204])
    add("progress: play resumes from it", "GET", f"/api/titles/{a['id']}/play", auth="h_x", expect=[{"path": "position_s", "equals": pa}])
    add("progress: a negative position is refused", "PUT", f"/api/progress/{b['id']}", auth="h_x", body={"position_s": -5}, status_in=[400, 422])
    add("progress: past the end is refused", "PUT", f"/api/progress/{b['id']}", auth="h_x", body={"position_s": b["duration_min"] * 60 + 30}, status_in=[400, 422])
    add("premium: a free plan can't save progress on a premium title", "PUT", f"/api/progress/{pm['id']}", auth="h_x", body={"position_s": 10}, status=403)
    add("progress: a second title", "PUT", f"/api/progress/{b['id']}", auth="h_x", body={"position_s": 90}, status_in=[200, 201, 204])
    add("continue watching: the latest first, with the position", "GET", "/api/home", auth="h_x",
        expect=[{"path": "continue_watching", "ids": sorted([a["id"], b["id"]])}, {"path": "continue_watching.0.id", "equals": b["id"]},
                {"path": f"continue_watching[id={a['id']}].position_s", "equals": pa}])
    add("continue watching: someone else's is not shown", "GET", "/api/home", auth="h_y", expect=[{"path": f"continue_watching[id={a['id']}]", "absent": True}])
    wl = HR.sample([m["id"] for m in movies], 3)
    for t in wl:
        add("watchlist: add a title", "PUT", f"/api/watchlist/{t}", auth="h_y", status_in=[200, 201, 204])
    add("watchlist: adding twice keeps one", "PUT", f"/api/watchlist/{wl[0]}", auth="h_y", status_in=[200, 201, 204])
    add("watchlist: lists what was added", "GET", "/api/watchlist", auth="h_y", expect=[{"path": "titles", "ids": sorted(wl)}])
    add("watchlist: another user's is separate", "GET", "/api/watchlist", auth="h_x", expect=[{"path": "titles", "len": 0}])
    add("watchlist: remove a title", "DELETE", f"/api/watchlist/{wl[1]}", auth="h_y", status_in=[200, 204])
    add("watchlist: the removed title is gone", "GET", "/api/watchlist", auth="h_y", expect=[{"path": "titles", "ids": sorted([wl[0], wl[2]])}])
    return hc


ap = argparse.ArgumentParser()
ap.add_argument("--hidden", metavar="DIR", help="also write DIR/<slug>/checks.json, the hidden checks (keep DIR out of git)")
ap.add_argument("--seed", type=int, help="the hidden checks' seed (default: a fresh one)")
args = ap.parse_args()
if args.hidden:
    HR = random.Random(args.seed if args.seed is not None else random.SystemRandom().getrandbits(64))
    for slug, gen in (("marketplace", hidden_market), ("hotels", hidden_hotels), ("cinema", hidden_cinema)):
        hcs = gen(HR)
        os.makedirs(os.path.join(args.hidden, slug), exist_ok=True)
        with open(os.path.join(args.hidden, slug, "checks.json"), "w") as f:
            json.dump(hcs, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("hidden", slug, len(hcs), "checks")
