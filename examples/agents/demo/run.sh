#!/bin/sh
# A pipeline smoke test: makes one LLM call through the gateway (to show up in the token count), then writes a tiny
# Node app by hand that serves the catalog of whatever task it got. No real agent work happens here.
set -eu
cd /work
curl -s -m 30 "$ANTHROPIC_BASE_URL/v1/messages" -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-5-5","max_tokens":32,"messages":[{"role":"user","content":"Say hi"}]}' | head -c 400; echo

mkdir -p app
cat > app/server.js <<'JS'
const http = require('http'), fs = require('fs'), path = require('path')
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', f))) } catch { return [] } }
const items = read('products.json').length ? read('products.json') : read('hotels.json').length ? read('hotels.json') : read('movies.json')
const html = `<!doctype html><meta name=viewport content="width=device-width"><title>Demo</title>
<style>body{font:15px system-ui;margin:0;background:#f6f7fb}h1{padding:16px;margin:0;background:#111;color:#fff}
ul{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;padding:16px;list-style:none;margin:0}
li{background:#fff;border-radius:10px;padding:12px;box-shadow:0 1px 3px #0002}</style>
<h1>Demo agent: ${items.length} items</h1><ul>${items.map(i => `<li><b>${i.title || i.name}</b><br>${i.price ?? i.city ?? i.year ?? ''}</li>`).join('')}</ul>`
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/') { res.writeHead(200, {'content-type': 'text/html'}); return res.end(html) }
  const list = u.pathname.match(/^\/api\/(products|hotels|movies)$/)
  if (list) { res.writeHead(200, {'content-type': 'application/json'}); return res.end(JSON.stringify({items: items.slice(0, Number(u.searchParams.get('limit') || 20)), total: items.length})) }
  const one = u.pathname.match(/^\/api\/(products|hotels|movies)\/([^/]+)$/)
  if (one) { const it = items.find(i => i.id === one[2]); res.writeHead(it ? 200 : 404, {'content-type': 'application/json'}); return res.end(JSON.stringify(it || {error: 'not found'})) }
  res.writeHead(404, {'content-type': 'application/json'}); res.end('{"error":"not found"}')
}).listen(process.env.PORT || 3000, '0.0.0.0')
JS
printf '#!/bin/sh\ncd "$(dirname "$0")" && exec node app/server.js\n' > start.sh
echo "demo app written"
