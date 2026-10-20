#!/bin/sh
# A pipeline smoke test: makes one LLM call through the gateway (to show up in the token count), then writes a
# hand-made storefront for whichever task it got: a Python standard-library server that serves the data as JSON and
# one plain HTML page per task. It passes the automatic checks and gives the preview something to show; it is not a
# full product (no cart, booking or player). No real agent work.
set -eu
cd /work
curl -s -m 30 "$ANTHROPIC_BASE_URL/v1/messages" -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-5-5","max_tokens":32,"messages":[{"role":"user","content":"Say hi"}]}' | head -c 400; echo

cat > server.py <<'PY'
import json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
TASK = open(os.path.join(HERE, "TASK")).read().strip()
DATA = {f[:-5]: open(os.path.join(HERE, "data", f), "rb").read() for f in os.listdir(os.path.join(HERE, "data")) if f.endswith(".json")}
PAGE = open(os.path.join(HERE, "ui", TASK + ".html"), "rb").read()


class H(BaseHTTPRequestHandler):
    def do_GET(self):
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
\$("#cats").onclick = (e) => { if (e.target.dataset.id !== undefined) { cat = e.target.dataset.id; draw() } }
\$("#q").oninput = draw
Promise.all([get("products"), get("categories")]).then(([p, c]) => { products = p; cats = c; draw() })
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
  show(cities[0])
})
</script></body></html>
HTML

cat > ui/cinema.html <<HTML
<!doctype html><html lang="en"><head><title>Online cinema</title>$HEAD</head><body style="background:#111;color:#eee">
<header><b>Cinema</b></header>
<main id="rows"></main>
<script>
const row = (title, items) => \`<h2>\${esc(title)}</h2><div class="row">\${items.map((m) => \`<div class="card" style="background:#1d1d22;color:#eee">
  \${art(m.id, m.title)}<div class="body"><div class="muted">\${m.year} · ★ \${m.rating}\${m.premium ? " · Premium" : ""}</div></div></div>\`).join("")}</div>\`
Promise.all([get("movies"), get("genres")]).then(([movies, genres]) => {
  const by = (f) => [...movies].sort(f).slice(0, 12)
  \$("#rows").innerHTML = row("Top rated", by((a, b) => b.rating - a.rating))
    + row("New arrivals", by((a, b) => b.added_at.localeCompare(a.added_at)))
    + genres.slice(0, 4).map((g) => row(g.name, movies.filter((m) => m.genres.includes(g.id)))).join("")
})
</script></body></html>
HTML

echo "$ARENA_TASK" > TASK
printf '#!/bin/sh\ncd "$(dirname "$0")" && exec python3 server.py\n' > start.sh
echo "demo storefront written for $ARENA_TASK"
