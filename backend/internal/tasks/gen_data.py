"""Generates the shared mock data of the tasks into catalog/<task>/data (deterministic: same seed, same files).

Usage: python3 backend/internal/tasks/gen_data.py backend/internal/tasks/catalog
IDs and counts are referenced by task.json checks and judge.md: re-check those after changing anything here.
"""
import json, random, sys, os, datetime

out = sys.argv[1]
R = random.Random(20261019)

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
            "image": f"https://picsum.photos/seed/dopamine-p{pid}/600/600",
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
            "photos": [f"https://picsum.photos/seed/dopamine-h{hid}-{k}/1000/700" for k in range(1, 4)],
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
        "poster": f"https://picsum.photos/seed/dopamine-m{i}/400/600",
        "backdrop": f"https://picsum.photos/seed/dopamine-mb{i}/1280/720",
        "stream_url": f"/media/{'m' + str(i)}.m3u8",
        "premium": R.random() < 0.35,
        "added_at": f"2026-{R.randint(1, 10):02d}-{R.randint(10, 28)}",
    }
    movies.append(m)
dump("cinema", "movies.json", movies)
dump("cinema", "genres.json", [{"id": g, "name": g.replace("-", " ").title()} for g in genres])
dump("cinema", "plans.json", [{"id": "free", "name": "Free", "price_month": 0, "includes_premium": False},
                               {"id": "premium", "name": "Premium", "price_month": 9.99, "includes_premium": True}])
dump("cinema", "users.json", users(8, lambda i: {"plan": "premium" if i % 2 == 0 else "free"}))
print("ok", len(products), len(hotels), len(rooms), len(movies))
