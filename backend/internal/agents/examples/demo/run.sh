#!/bin/sh
# A pipeline smoke test: makes one LLM call through the gateway (to show up in the token count), then writes a
# hand-made storefront for whichever task it got: a Python standard-library server that serves the data as JSON and
# one plain HTML page per task. It passes the automatic checks and gives the preview something to show; it is not a
# full product. For every task it implements the API contract and the pages from TASK.md: the reference the checks
# are tested against. No real agent work.
set -eu
cd /work
curl -s -m 30 "$ANTHROPIC_BASE_URL/v1/messages" -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-5-5","max_tokens":32,"messages":[{"role":"user","content":"Say hi"}]}' | head -c 400; echo

cat > server.py <<'PY'
import datetime, json, os, secrets, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
TASK = open(os.path.join(HERE, "TASK")).read().strip()
DATA = {f[:-5]: open(os.path.join(HERE, "data", f), "rb").read() for f in os.listdir(os.path.join(HERE, "data")) if f.endswith(".json")}
PAGE = open(os.path.join(HERE, "ui", TASK + ".html"), "rb").read()


class HotelsAPI:
    """The hotels API contract from TASK.md, in memory."""

    def __init__(self):
        self.hotels = {h["id"]: h for h in json.loads(DATA["hotels"])}
        self.rooms = {r["id"]: r for r in json.loads(DATA["rooms"])}
        self.users = json.loads(DATA["users"])
        self.bookings = [b for b in json.loads(DATA["bookings"]) if b.get("status", "confirmed") == "confirmed"]
        self.tokens, self.lock = {}, threading.Lock()

    @staticmethod
    def stay(q):
        try:
            ci, co = datetime.date.fromisoformat(q["check_in"]), datetime.date.fromisoformat(q["check_out"])
            guests = int(q.get("guests") or 1)
        except (KeyError, ValueError):
            return None
        if co <= ci or guests < 1:
            return None
        return ci, co, guests

    def free(self, room, ci, co):
        days = [(ci + datetime.timedelta(days=k)).isoformat() for k in range((co - ci).days)]
        return all(sum(1 for b in self.bookings if b["room_id"] == room["id"] and b["check_in"] <= d < b["check_out"]) < room["inventory"] for d in days)

    def room_view(self, r, ci, co):
        return {**r, "price_total": r["price_per_night"] * (co - ci).days, "available": self.free(r, ci, co)}

    def handle(self, method, path, q, body, auth):
        user = self.tokens.get(auth.removeprefix("Bearer ").strip()) if auth else None
        if method == "GET" and path == "/api/search":
            s = self.stay(q)
            if not s:
                return 400, {"error": "check_in and check_out must be dates, check-out after check-in"}
            ci, co, guests = s
            want = [a for a in q.get("amenities", "").split(",") if a]
            out = []
            for h in self.hotels.values():
                if h["city"] != q.get("city") or not set(want) <= set(h["amenities"]):
                    continue
                totals = [r["price_per_night"] * (co - ci).days for r in self.rooms.values()
                          if r["hotel_id"] == h["id"] and r["capacity"] >= guests and self.free(r, ci, co)]
                if totals:
                    out.append({**h, "price_total": min(totals)})
            key = {"price": lambda h: h["price_total"], "rating": lambda h: -h["rating"], "stars": lambda h: -h["stars"],
                   "distance": lambda h: h["distance_to_center_km"]}.get(q.get("sort"))
            return 200, {"hotels": sorted(out, key=key) if key else out}
        if method == "GET" and path.startswith("/api/hotels/"):
            h = self.hotels.get(path.rsplit("/", 1)[1])
            if not h:
                return 404, {"error": "no such hotel"}
            s = self.stay(q)
            rooms = [r for r in self.rooms.values() if r["hotel_id"] == h["id"]]
            return 200, {**h, "rooms": [self.room_view(r, s[0], s[1]) if s else r for r in rooms]}
        if method == "POST" and path == "/api/login":
            u = next((u for u in self.users if u["email"] == body.get("email") and u["password"] == body.get("password")), None)
            if not u:
                return 401, {"error": "wrong email or password"}
            token = secrets.token_hex(16)
            self.tokens[token] = u
            return 200, {"token": token, "user": {"id": u["id"], "name": u["name"]}}
        if path.startswith("/api/bookings"):
            if not user:
                return 401, {"error": "sign in first"}
            mine = lambda: [{**b, "total": self.rooms[b["room_id"]]["price_per_night"] * (datetime.date.fromisoformat(b["check_out"]) - datetime.date.fromisoformat(b["check_in"])).days}
                            for b in self.bookings if b["user_id"] == user["id"]]
            if method == "GET" and path == "/api/bookings":
                return 200, {"bookings": mine()}
            if method == "POST" and path == "/api/bookings":
                room, s = self.rooms.get(body.get("room_id")), self.stay(body)
                if not room or not s or s[2] > room["capacity"]:
                    return 400, {"error": "unknown room, bad dates or too many guests"}
                with self.lock:
                    if not self.free(room, s[0], s[1]):
                        return 409, {"error": "the room is not free for these dates"}
                    b = {"id": "b-" + secrets.token_hex(4), "room_id": room["id"], "hotel_id": room["hotel_id"], "user_id": user["id"],
                         "check_in": s[0].isoformat(), "check_out": s[1].isoformat(), "guests": s[2], "status": "confirmed"}
                    self.bookings.append(b)
                return 201, next(x for x in mine() if x["id"] == b["id"])
            if method == "DELETE":
                bid = path.rsplit("/", 1)[1]
                with self.lock:
                    b = next((b for b in self.bookings if b["id"] == bid and b["user_id"] == user["id"]), None)
                    if not b:
                        return 404, {"error": "no such booking"}
                    self.bookings.remove(b)
                return 200, {"ok": True}
        return None


class CinemaAPI:
    """The cinema API contract from TASK.md, in memory."""

    FIELDS = ("id", "title", "type", "year", "genres", "rating", "premium", "added_at")

    def __init__(self):
        self.titles = {m["id"]: m for m in json.loads(DATA["movies"])}
        self.users = json.loads(DATA["users"])
        self.premium_plans = {p["id"] for p in json.loads(DATA["plans"]) if p["includes_premium"]}
        self.tokens, self.progress, self.watchlist, self.tick = {}, {}, {}, 0

    def item(self, m, **extra):
        return {**{k: m[k] for k in self.FIELDS}, **extra}

    @staticmethod
    def duration(m, q):
        if m["type"] == "movie":
            return m["duration_min"] * 60
        try:
            s = next(s for s in m["seasons"] if s["number"] == int(q.get("season") or 1))
            return next(e for e in s["episodes"] if e["number"] == int(q.get("episode") or 1))["duration_min"] * 60
        except (StopIteration, ValueError):
            return None

    def handle(self, method, path, q, body, auth):
        user = self.tokens.get(auth.removeprefix("Bearer ").strip()) if auth else None
        parts = path.strip("/").split("/")[1:]  # without "api"
        if method == "GET" and parts == ["titles"]:
            items = [m for m in self.titles.values()
                     if q.get("q", "").lower() in m["title"].lower()
                     and (not q.get("genre") or q["genre"] in m["genres"]) and (not q.get("type") or m["type"] == q["type"])]
            key = {"rating": "rating", "year": "year", "added": "added_at"}.get(q.get("sort"))
            if key:
                items.sort(key=lambda m: m[key], reverse=True)
            return 200, {"titles": [self.item(m) for m in items]}
        if method == "GET" and parts == ["home"]:
            top = lambda key: [self.item(m) for m in sorted(self.titles.values(), key=lambda m: m[key], reverse=True)[:10]]
            res = {"top_rated": top("rating"), "new_arrivals": top("added_at")}
            if user:
                mine = sorted(self.progress.get(user["id"], {}).items(), key=lambda kv: kv[1][1], reverse=True)
                res["continue_watching"] = [self.item(self.titles[i], position_s=p) for i, (p, _) in mine]
            return 200, res
        if method == "POST" and parts == ["login"]:
            u = next((u for u in self.users if u["email"] == body.get("email") and u["password"] == body.get("password")), None)
            if not u:
                return 401, {"error": "wrong email or password"}
            token = secrets.token_hex(16)
            self.tokens[token] = u
            return 200, {"token": token}
        if method == "GET" and len(parts) == 2 and parts[0] == "titles":
            m = self.titles.get(parts[1])
            return (200, m) if m else (404, {"error": "no such title"})
        if parts[:1] not in (["me"], ["titles"], ["progress"], ["watchlist"]):
            return None
        if not user:
            return 401, {"error": "sign in first"}
        if method == "GET" and parts == ["me"]:
            return 200, {k: user[k] for k in ("id", "name", "email", "plan")}
        if method == "GET" and parts == ["watchlist"]:
            return 200, {"titles": [self.item(self.titles[i]) for i in self.watchlist.get(user["id"], [])]}
        m = self.titles.get(parts[1]) if len(parts) >= 2 else None
        if not m:
            return 404, {"error": "no such title"}
        if parts[0] == "watchlist":
            wl = self.watchlist.setdefault(user["id"], [])
            if method == "PUT":
                if m["id"] not in wl:
                    wl.insert(0, m["id"])
                return 200, {"titles": wl}
            if method == "DELETE":
                if m["id"] in wl:
                    wl.remove(m["id"])
                return 204, None
            return None
        if m["premium"] and user["plan"] not in self.premium_plans:
            return 403, {"error": "this title needs the premium plan"}
        dur = self.duration(m, q)
        if dur is None:
            return 404, {"error": "no such episode"}
        saved = self.progress.setdefault(user["id"], {})
        if method == "GET" and parts[2:] == ["play"]:
            return 200, {"title_id": m["id"], "duration_s": dur, "position_s": saved.get(m["id"], (0, 0))[0]}
        if method == "PUT" and parts[0] == "progress":
            pos = body.get("position_s")
            if not isinstance(pos, (int, float)) or isinstance(pos, bool) or not 0 <= pos <= dur:
                return 400, {"error": "position_s must be between 0 and the duration"}
            self.tick += 1
            saved[m["id"]] = (pos, self.tick)
            return 200, {"title_id": m["id"], "position_s": pos}
        return None


class MarketAPI:
    """The marketplace API contract from TASK.md, in memory."""

    def __init__(self):
        self.products = {p["id"]: p for p in json.loads(DATA["products"])}
        self.sellers = {s["id"]: s for s in json.loads(DATA["sellers"])}
        self.reviews = json.loads(DATA["reviews"])
        self.users = json.loads(DATA["users"])
        self.carts, self.orders, self.tokens, self.lock = {}, [], {}, threading.Lock()

    def cart(self, uid):
        items = [{"product_id": pid, "title": self.products[pid]["title"], "price": self.products[pid]["price"], "quantity": n,
                  "subtotal": round(self.products[pid]["price"] * n, 2)} for pid, n in self.carts.get(uid, {}).items()]
        return {"items": items, "total": round(sum(i["subtotal"] for i in items), 2)}

    def handle(self, method, path, q, body, auth):
        user = self.tokens.get(auth.removeprefix("Bearer ").strip()) if auth else None
        if method == "GET" and path == "/api/products":
            text, cat = q.get("q", "").lower(), q.get("category")
            out = [p for p in self.products.values() if text in p["title"].lower() and (not cat or p["category"] == cat)]
            key = {"price": lambda p: p["price"], "price_desc": lambda p: -p["price"], "rating": lambda p: -p["rating"]}.get(q.get("sort"))
            return 200, {"products": sorted(out, key=key) if key else out}
        if method == "GET" and path.startswith("/api/products/"):
            p = self.products.get(path.rsplit("/", 1)[1])
            if not p:
                return 404, {"error": "no such product"}
            return 200, {**p, "seller": self.sellers.get(p["seller_id"]),
                         "reviews": [r for r in self.reviews if r["product_id"] == p["id"]]}
        if method == "POST" and path == "/api/login":
            u = next((u for u in self.users if u["email"] == body.get("email") and u["password"] == body.get("password")), None)
            if not u:
                return 401, {"error": "wrong email or password"}
            token = secrets.token_hex(16)
            self.tokens[token] = u
            return 200, {"token": token, "user": {"id": u["id"], "name": u["name"]}}
        if not (path.startswith("/api/cart") or path.startswith("/api/orders")):
            return None
        if not user:
            return 401, {"error": "sign in first"}
        uid = user["id"]
        if method == "GET" and path == "/api/cart":
            return 200, self.cart(uid)
        if method == "POST" and path == "/api/cart":
            p, n = self.products.get(body.get("product_id")), body.get("quantity")
            if not isinstance(n, int) or isinstance(n, bool) or n < 0:
                return 400, {"error": "quantity must be a whole number, 0 or more"}
            if not p:
                return 404, {"error": "no such product"}
            if n > p["stock"]:
                return 409, {"error": f"only {p['stock']} in stock"}
            cart = self.carts.setdefault(uid, {})
            if n:
                cart[p["id"]] = n
            else:
                cart.pop(p["id"], None)
            return 200, self.cart(uid)
        if method == "GET" and path == "/api/orders":
            return 200, {"orders": [o for o in self.orders if o["user_id"] == uid]}
        if method == "POST" and path == "/api/orders":
            with self.lock:
                cart = self.carts.get(uid) or {}
                if not cart:
                    return 400, {"error": "the cart is empty"}
                short = [pid for pid, n in cart.items() if n > self.products[pid]["stock"]]
                if short:
                    return 409, {"error": "not enough stock for " + ", ".join(short)}
                for pid, n in cart.items():
                    self.products[pid]["stock"] -= n
                c = self.cart(uid)
                o = {"id": "o-" + secrets.token_hex(4), "user_id": uid, "total": c["total"],
                     "items": [{k: i[k] for k in ("product_id", "title", "price", "quantity")} for i in c["items"]]}
                self.orders.append(o)
                self.carts[uid] = {}
            return 201, o
        return None


API = {"hotels": HotelsAPI, "marketplace": MarketAPI, "cinema": CinemaAPI}.get(TASK, lambda: None)()


class H(BaseHTTPRequestHandler):
    def api(self, method):
        u = urlparse(self.path)
        if not API or not u.path.startswith("/api/"):
            return False
        body = {}
        if method in ("POST", "PUT"):
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            except ValueError:
                body = None
            if not isinstance(body, dict):
                self.send(400, "application/json", b'{"error": "send a JSON object"}')
                return True
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        res = API.handle(method, u.path, q, body, self.headers.get("Authorization", ""))
        if res is None:
            return False
        self.send(res[0], "application/json", b"" if res[1] is None else json.dumps(res[1]).encode())
        return True

    def do_POST(self):
        if not self.api("POST"):
            self.send(404, "application/json", b'{"error": "not found"}')

    def do_PUT(self):
        if not self.api("PUT"):
            self.send(404, "application/json", b'{"error": "not found"}')

    def do_DELETE(self):
        if not self.api("DELETE"):
            self.send(404, "application/json", b'{"error": "not found"}')

    def do_GET(self):
        if self.api("GET"):
            return
        path = self.path.split("?")[0]
        if path.startswith("/api/") and path[5:] in DATA and path[5:] != "users":
            self.send(200, "application/json", DATA[path[5:]])
        elif path == "/" or not path.startswith("/api/"):
            self.send(200, "text/html; charset=utf-8", PAGE)
        else:
            self.send(404, "application/json", b'{"error": "not found"}')

    def send(self, status, ctype, body):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "3000"))), H).serve_forever()
PY

mkdir -p ui
# Shared look: one stylesheet and helpers, pasted into each page (no build step, no CDN).
HEAD='<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,sans-serif;background:#f6f5f2;color:#1b1b1f}
header{display:flex;gap:16px;align-items:center;padding:14px 20px;background:#1b1b1f;color:#fff}
header b{font-size:18px;letter-spacing:.02em}header input{flex:1;max-width:420px;padding:8px 12px;border-radius:8px;border:0}
main{max-width:1180px;margin:0 auto;padding:20px}h2{margin:28px 0 12px;font-size:20px}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{padding:6px 12px;border-radius:999px;background:#fff;border:1px solid #ddd;cursor:pointer}
.chip.on{background:#1b1b1f;color:#fff;border-color:#1b1b1f}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px}
.card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px #0001}.card .art{height:150px;display:grid;place-items:center;color:#fff;font-weight:700;font-size:28px}
.card .body{padding:10px 12px}.muted{color:#6b6b74;font-size:13px}.price{font-weight:700}.old{text-decoration:line-through;color:#999;margin-left:6px;font-weight:400}
.row{display:flex;gap:14px;overflow-x:auto;padding-bottom:8px}.row .card{flex:0 0 160px}.row .art{height:220px;font-size:16px;padding:12px;text-align:center}
@media (max-width:600px){header{flex-wrap:wrap}main{padding:14px}}
</style>
<script>
const $ = (s) => document.querySelector(s)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c])
const hue = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
const art = (id, text) => `<div class="art" style="background:linear-gradient(135deg,hsl(${hue(id)} 60% 45%),hsl(${(hue(id) + 60) % 360} 70% 30%))">${esc(text)}</div>`
const get = (name) => fetch("/api/" + name).then((r) => r.json())
</script>'

cat > ui/marketplace.html <<HTML
<!doctype html><html lang="en"><head><title>Marketplace</title>$HEAD</head><body>
<header><b>Marketplace</b><input id="q" placeholder="Search products" aria-label="Search products"></header>
<main><div class="chips" id="cats"></div><h2 id="heading">All products</h2><div class="grid" id="grid"></div></main>
<script>
let cat = "", products = [], cats = []
function draw() {
  const q = \$("#q").value.toLowerCase()
  \$("#cats").innerHTML = [{ id: "", name: "All" }, ...cats].map((c) => \`<button class="chip\${c.id === cat ? " on" : ""}" data-id="\${c.id}">\${esc(c.name)}</button>\`).join("")
  const items = products.filter((p) => (!cat || p.category === cat) && p.title.toLowerCase().includes(q))
  \$("#grid").innerHTML = items.map((p) => \`<div class="card">\${art(p.id, p.title.split(" ").map((w) => w[0]).join("").slice(0, 3))}<div class="body">
    <div>\${esc(p.title)}</div><div class="muted">★ \${p.rating} · \${p.reviews_count} reviews</div>
    <div><span class="price">\$\${p.price}</span>\${p.old_price ? \`<span class="old">\$\${p.old_price}</span>\` : ""}</div>
    <div class="muted">\${p.stock ? p.stock + " in stock" : "Sold out"}</div></div></div>\`).join("")
}
const params = new URLSearchParams(location.search)
if (location.pathname.startsWith("/products/")) {
  fetch("/api/products/" + location.pathname.split("/")[2]).then((r) => r.json()).then((p) => {
    \$("#heading").textContent = p.title
    \$("#grid").innerHTML = \`<div class="card" style="grid-column:1/-1"><div class="body"><div class="price">\$\${p.price}</div>
      <div>\${esc(p.description)}</div><div class="muted">Sold by \${esc(p.seller.name)} · \${p.stock ? p.stock + " in stock" : "Sold out"}</div>
      \${p.reviews.map((r) => \`<p>\${"★".repeat(r.rating)} \${esc(r.text)}</p>\`).join("")}</div></div>\`
  })
} else {
  \$("#q").value = params.get("q") || ""
  \$("#cats").onclick = (e) => { if (e.target.dataset.id !== undefined) { cat = e.target.dataset.id; draw() } }
  \$("#q").oninput = draw
  Promise.all([get("products"), get("categories")]).then(([p, c]) => { products = p.products || p; cats = c; draw() })
}
</script></body></html>
HTML

cat > ui/hotels.html <<HTML
<!doctype html><html lang="en"><head><title>Hotel booking</title>$HEAD</head><body>
<header><b>Stays</b></header>
<main>
<form id="search" class="chips" style="align-items:end">
  <label>City<br><select id="city"></select></label>
  <label>Check-in<br><input type="date" id="in" value="2027-02-10"></label>
  <label>Check-out<br><input type="date" id="out" value="2027-02-12"></label>
  <label>Guests<br><input type="number" id="guests" value="2" min="1" max="6" style="width:70px"></label>
</form>
<h2>Popular destinations</h2><div class="grid" id="cities"></div>
<h2 id="heading"></h2><div class="grid" id="hotels"></div>
</main>
<script>
// /search and /hotels/{id} (deep links from TASK.md) render from the API; / shows the destinations.
const params = new URLSearchParams(location.search)
const stay = ["check_in", "check_out", "guests"].map((k) => k + "=" + encodeURIComponent(params.get(k) || "")).join("&")
const card = (h, price) => \`<div class="card">\${art(h.id, "★".repeat(h.stars))}<div class="body"><a href="/hotels/\${h.id}?\${stay}">\${esc(h.name)}</a>
  <div class="muted">\${h.rating} · \${h.distance_to_center_km} km from the centre</div><div>\${price}</div></div></div>\`
if (location.pathname === "/search") {
  fetch("/api/search" + location.search).then((r) => r.json()).then((d) => {
    \$("#heading").textContent = "Hotels in " + params.get("city")
    \$("#hotels").innerHTML = (d.hotels || []).map((h) => card(h, \`<span class="price">€\${h.price_total}</span> for the stay\`)).join("")
  })
} else if (location.pathname.startsWith("/hotels/")) {
  fetch("/api" + location.pathname + "?" + stay).then((r) => r.json()).then((h) => {
    \$("#heading").textContent = h.name
    \$("#hotels").innerHTML = \`<div class="card" style="grid-column:1/-1"><div class="body">\${esc(h.description)}<div class="muted">\${esc(h.address)} · \${h.amenities.join(", ")}</div></div></div>\`
      + h.rooms.map((r) => \`<div class="card"><div class="body"><div>\${esc(r.type)} · up to \${r.capacity}</div>
        <div class="muted">€\${r.price_per_night} / night</div><div><span class="price">€\${r.price_total ?? ""}</span> \${r.available ? "free" : "not available"}</div></div></div>\`).join("")
  })
}
let hotels = [], rooms = []
function show(city) {
  \$("#city").value = city
  \$("#heading").textContent = "Hotels in " + city
  \$("#hotels").innerHTML = hotels.filter((h) => h.city === city).map((h) => {
    const from = Math.min(...rooms.filter((r) => r.hotel_id === h.id).map((r) => r.price_per_night))
    return \`<div class="card">\${art(h.id, "★".repeat(h.stars))}<div class="body"><div>\${esc(h.name)}</div>
      <div class="muted">\${h.rating} · \${h.distance_to_center_km} km from the centre</div><div>from <span class="price">€\${from}</span> / night</div></div></div>\`
  }).join("")
}
Promise.all([get("hotels"), get("rooms")]).then(([h, r]) => {
  hotels = h; rooms = r
  const cities = [...new Set(h.map((x) => x.city))]
  \$("#city").innerHTML = cities.map((c) => \`<option>\${esc(c)}</option>\`).join("")
  \$("#cities").innerHTML = cities.map((c) => \`<div class="card" data-city="\${esc(c)}" style="cursor:pointer">\${art(c, c)}<div class="body muted">\${h.filter((x) => x.city === c).length} hotels</div></div>\`).join("")
  \$("#cities").onclick = (e) => { const c = e.target.closest("[data-city]"); if (c) show(c.dataset.city) }
  \$("#city").onchange = () => show(\$("#city").value)
  if (location.pathname === "/") show(cities[0])
})
</script></body></html>
HTML

cat > ui/cinema.html <<HTML
<!doctype html><html lang="en"><head><title>Online cinema</title>$HEAD</head><body style="background:#111;color:#eee">
<header><b><a href="/" style="color:#fff;text-decoration:none">Cinema</a></b>
<form action="/search" style="flex:1"><input name="q" placeholder="Search titles" aria-label="Search titles"></form></header>
<main id="rows"></main>
<script>
// /titles/{id}, /search and /watchlist (deep links from TASK.md) render from the API; / shows the home rows.
const card = (m) => \`<div class="card" style="background:#1d1d22;color:#eee"><a href="/titles/\${m.id}" style="color:inherit">
  \${art(m.id, m.title)}</a><div class="body"><div>\${esc(m.title)}</div><div class="muted">\${m.year} · ★ \${m.rating}\${m.premium ? " · Premium" : ""}</div></div></div>\`
const row = (title, items) => \`<h2>\${esc(title)}</h2><div class="row">\${items.map(card).join("")}</div>\`
const api = (p) => fetch("/api/" + p, { headers: localStorage.token ? { Authorization: "Bearer " + localStorage.token } : {} }).then((r) => r.json())
const path = location.pathname
if (path.startsWith("/titles/")) {
  api("titles/" + path.split("/")[2]).then((m) => {
    \$("#rows").innerHTML = \`<h2>\${esc(m.title)}</h2><p>\${esc(m.description)}</p>
      <p class="muted">\${m.year} · \${m.genres.join(", ")} · \${m.age_rating} · \${m.duration_min ? m.duration_min + " min" : m.seasons.length + " seasons"}</p>
      <p>Director: \${esc(m.director)}</p><p class="muted">Cast: \${m.cast.map(esc).join(", ")}</p>\`
  })
} else if (path === "/search") {
  const q = new URLSearchParams(location.search).get("q") || ""
  api("titles?q=" + encodeURIComponent(q)).then((d) => { \$("#rows").innerHTML = row("Results for " + q, d.titles) })
} else if (path === "/watchlist") {
  api("watchlist").then((d) => { \$("#rows").innerHTML = d.titles ? row("My list", d.titles) : "<h2>Sign in to see your list</h2>" })
} else {
  Promise.all([api("home"), get("movies"), get("genres")]).then(([home, movies, genres]) => {
    \$("#rows").innerHTML = (home.continue_watching?.length ? row("Continue watching", home.continue_watching) : "")
      + row("Top rated", home.top_rated) + row("New arrivals", home.new_arrivals)
      + genres.slice(0, 4).map((g) => row(g.name, movies.filter((m) => m.genres.includes(g.id)))).join("")
  })
}
</script></body></html>
HTML

echo "$ARENA_TASK" > TASK
printf '#!/bin/sh\ncd "$(dirname "$0")" && exec python3 server.py\n' > start.sh
echo "demo storefront written for $ARENA_TASK"
