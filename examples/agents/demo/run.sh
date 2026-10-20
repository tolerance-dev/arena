#!/bin/sh
# A pipeline smoke test: makes one LLM call through the gateway (to show up in the token count), then writes a
# hand-made reference solution for whichever task it got (Python standard library + one plain HTML page per task).
# No real agent work.
set -eu
cd /work
curl -s -m 30 "$ANTHROPIC_BASE_URL/v1/messages" -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-5-5","max_tokens":32,"messages":[{"role":"user","content":"Say hi"}]}' | head -c 400; echo

cat > server.py <<'PY'
import heapq, json, os, re
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TASK = os.environ.get("ARENA_TASK") or open(os.path.join(os.path.dirname(__file__), "TASK")).read().strip()
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


class HTTPError(Exception):
    def __init__(self, status, msg):
        self.status, self.msg = status, msg


# ---------------------------------------------------------------- red-black tree (CLRS, with a nil sentinel)

class Node:
    __slots__ = ("key", "red", "left", "right", "parent")

    def __init__(self, key, nil):
        self.key, self.red, self.left, self.right, self.parent = key, True, nil, nil, nil


class RBTree:
    def __init__(self):
        self.nil = Node(None, None)
        self.nil.red = False
        self.root, self.size = self.nil, 0

    def find(self, k):
        x = self.root
        while x is not self.nil and x.key != k:
            x = x.left if k < x.key else x.right
        return None if x is self.nil else x

    def rotate(self, x, left):
        y = x.right if left else x.left
        if left:
            x.right = y.left
            if y.left is not self.nil:
                y.left.parent = x
        else:
            x.left = y.right
            if y.right is not self.nil:
                y.right.parent = x
        y.parent = x.parent
        if x.parent is self.nil:
            self.root = y
        elif x is x.parent.left:
            x.parent.left = y
        else:
            x.parent.right = y
        if left:
            y.left = x
        else:
            y.right = x
        x.parent = y

    def insert(self, k):
        y, x = self.nil, self.root
        while x is not self.nil:
            if k == x.key:
                return False
            y, x = x, (x.left if k < x.key else x.right)
        z = Node(k, self.nil)
        z.parent = y
        if y is self.nil:
            self.root = z
        elif k < y.key:
            y.left = z
        else:
            y.right = z
        while z.parent.red:
            gp = z.parent.parent
            left = z.parent is gp.left
            uncle = gp.right if left else gp.left
            if uncle.red:
                z.parent.red = uncle.red = False
                gp.red = True
                z = gp
            else:
                if z is (z.parent.right if left else z.parent.left):
                    z = z.parent
                    self.rotate(z, left)
                z.parent.red = False
                z.parent.parent.red = True
                self.rotate(z.parent.parent, not left)
        self.root.red = False
        self.size += 1
        return True

    def transplant(self, u, v):
        if u.parent is self.nil:
            self.root = v
        elif u is u.parent.left:
            u.parent.left = v
        else:
            u.parent.right = v
        v.parent = u.parent

    def delete(self, k):
        z = self.find(k)
        if z is None:
            return False
        y, y_red = z, z.red
        if z.left is self.nil:
            x = z.right
            self.transplant(z, z.right)
        elif z.right is self.nil:
            x = z.left
            self.transplant(z, z.left)
        else:
            y = z.right
            while y.left is not self.nil:
                y = y.left
            y_red, x = y.red, y.right
            if y.parent is z:
                x.parent = y
            else:
                self.transplant(y, y.right)
                y.right = z.right
                y.right.parent = y
            self.transplant(z, y)
            y.left = z.left
            y.left.parent = y
            y.red = z.red
        if not y_red:
            while x is not self.root and not x.red:
                left = x is x.parent.left
                w = x.parent.right if left else x.parent.left
                if w.red:
                    w.red, x.parent.red = False, True
                    self.rotate(x.parent, left)
                    w = x.parent.right if left else x.parent.left
                near, far = (w.left, w.right) if left else (w.right, w.left)
                if not near.red and not far.red:
                    w.red = True
                    x = x.parent
                else:
                    if not far.red:
                        near.red, w.red = False, True
                        self.rotate(w, not left)
                        w = x.parent.right if left else x.parent.left
                        far = w.right if left else w.left
                    w.red, x.parent.red, far.red = x.parent.red, False, False
                    self.rotate(x.parent, left)
                    x = self.root
            x.red = False
        self.size -= 1
        return True

    def to_json(self, n=None):
        n = self.root if n is None else n
        if n is self.nil:
            return None
        return {"key": n.key, "color": "red" if n.red else "black", "left": self.to_json(n.left), "right": self.to_json(n.right)}

    def keys(self):
        out, stack, x = [], [], self.root
        while stack or x is not self.nil:
            while x is not self.nil:
                stack.append(x)
                x = x.left
            x = stack.pop()
            out.append(x.key)
            x = x.right
        return out


def int_keys(body):
    ks = body.get("keys") if isinstance(body, dict) else None
    if not isinstance(ks, list) or not all(isinstance(k, int) and not isinstance(k, bool) for k in ks):
        raise HTTPError(400, "keys must be an array of integers")
    return ks


def rbtree_app():
    t = RBTree()
    for k in json.load(open(os.path.join(DATA, "keys.json"))):
        t.insert(k)

    def handle(method, path, q, body):
        if method == "GET" and path == "/api/tree":
            return 200, {"size": t.size, "root": t.to_json()}
        if method == "GET" and path == "/api/tree/keys":
            return 200, t.keys()
        if method == "GET" and path == "/api/tree/search":
            try:
                k = int(q.get("key", [""])[0])
            except ValueError:
                raise HTTPError(400, "key must be an integer")
            n = t.find(k)
            if n is None:
                raise HTTPError(404, "no such key")
            return 200, {"key": n.key, "color": "red" if n.red else "black"}
        if method == "POST" and path == "/api/tree/insert":
            return 200, {"inserted": sum(t.insert(k) for k in int_keys(body)), "size": t.size}
        if method == "POST" and path == "/api/tree/delete":
            return 200, {"deleted": sum(t.delete(k) for k in int_keys(body)), "size": t.size}
        raise HTTPError(404, "not found")
    return handle


# ---------------------------------------------------------------- doubly linked list

class LNode:
    __slots__ = ("value", "prev", "next")

    def __init__(self, value):
        self.value, self.prev, self.next = value, None, None


class DList:
    def __init__(self):
        self.head = self.tail = None
        self.size = 0

    def node_at(self, i):
        if i < self.size // 2:
            n = self.head
            for _ in range(i):
                n = n.next
        else:
            n = self.tail
            for _ in range(self.size - 1 - i):
                n = n.prev
        return n

    def insert(self, i, value):
        n = LNode(value)
        after = self.node_at(i) if i < self.size else None  # the new node goes before `after`
        before = after.prev if after else self.tail
        n.prev, n.next = before, after
        if before:
            before.next = n
        else:
            self.head = n
        if after:
            after.prev = n
        else:
            self.tail = n
        self.size += 1

    def remove(self, n):
        if n.prev:
            n.prev.next = n.next
        else:
            self.head = n.next
        if n.next:
            n.next.prev = n.prev
        else:
            self.tail = n.prev
        self.size -= 1
        return n.value

    def items(self, backward=False):
        out, n = [], self.tail if backward else self.head
        while n:
            out.append(n.value)
            n = n.prev if backward else n.next
        return out

    def reverse(self):
        n = self.head
        while n:
            n.prev, n.next = n.next, n.prev
            n = n.prev
        self.head, self.tail = self.tail, self.head


def value_of(body):
    v = body.get("value") if isinstance(body, dict) else None
    if not isinstance(v, str) or not v:
        raise HTTPError(400, "value must be a non-empty string")
    return v


def list_app():
    l = DList()
    for v in json.load(open(os.path.join(DATA, "items.json"))):
        l.insert(l.size, v)

    def handle(method, path, q, body):
        if method == "GET" and path == "/api/list":
            return 200, {"size": l.size, "items": l.items()}
        if method == "GET" and path == "/api/list/backward":
            return 200, {"items": l.items(backward=True)}
        if method == "POST" and path in ("/api/list/push-front", "/api/list/push-back"):
            l.insert(0 if path.endswith("front") else l.size, value_of(body))
            return 201, {"size": l.size}
        if method == "POST" and path in ("/api/list/pop-front", "/api/list/pop-back"):
            if not l.size:
                raise HTTPError(409, "the list is empty")
            return 200, {"value": l.remove(l.head if path.endswith("front") else l.tail)}
        if method == "POST" and path == "/api/list/insert":
            i = body.get("index") if isinstance(body, dict) else None
            if not isinstance(i, int) or isinstance(i, bool) or not 0 <= i <= l.size:
                raise HTTPError(400, "index out of range")
            l.insert(i, value_of(body))
            return 201, {"size": l.size}
        m = re.fullmatch(r"/api/list/items/(-?\d+)", path)
        if method == "DELETE" and m:
            i = int(m.group(1))
            if not 0 <= i < l.size:
                raise HTTPError(404, "index out of range")
            return 200, {"value": l.remove(l.node_at(i))}
        if method == "POST" and path == "/api/list/reverse":
            l.reverse()
            return 200, {"size": l.size, "items": l.items()}
        if method == "POST" and path == "/api/list/clear":
            l.head = l.tail = None
            l.size = 0
            return 200, {"size": 0}
        raise HTTPError(404, "not found")
    return handle


# ---------------------------------------------------------------- directed graph

def graph_app():
    seed = json.load(open(os.path.join(DATA, "graph.json")))
    out = {n: {} for n in seed["nodes"]}  # node → {neighbour: weight}
    for e in seed["edges"]:
        out[e["from"]][e["to"]] = e["weight"]

    def need(n):
        if n not in out:
            raise HTTPError(404, f"no node {n}")

    def handle(method, path, q, body):
        arg = lambda k: q.get(k, [""])[0]
        if method == "GET" and path == "/api/graph":
            return 200, {"nodes": sorted(out), "edges": [{"from": u, "to": v, "weight": w}
                                                          for u in sorted(out) for v, w in sorted(out[u].items())]}
        if method == "POST" and path == "/api/nodes":
            n = body.get("id") if isinstance(body, dict) else None
            if not isinstance(n, str) or not n:
                raise HTTPError(400, "id must be a non-empty string")
            if n in out:
                raise HTTPError(409, "node exists")
            out[n] = {}
            return 201, {"id": n}
        m = re.fullmatch(r"/api/nodes/([^/]+)", path)
        if method == "DELETE" and m:
            n = m.group(1)
            need(n)
            del out[n]
            for adj in out.values():
                adj.pop(n, None)
            return 200, {"deleted": n}
        if method == "POST" and path == "/api/edges":
            b = body if isinstance(body, dict) else {}
            u, v, w = b.get("from"), b.get("to"), b.get("weight")
            if not isinstance(w, int) or isinstance(w, bool) or w <= 0:
                raise HTTPError(400, "weight must be a positive integer")
            if u == v:
                raise HTTPError(400, "self-loops are not allowed")
            need(u)
            need(v)
            if v in out[u]:
                raise HTTPError(409, "edge exists")
            out[u][v] = w
            return 201, {"from": u, "to": v, "weight": w}
        m = re.fullmatch(r"/api/edges/([^/]+)/([^/]+)", path)
        if method == "DELETE" and m:
            u, v = m.groups()
            if u not in out or v not in out[u]:
                raise HTTPError(404, "no such edge")
            del out[u][v]
            return 200, {"deleted": [u, v]}
        if method == "GET" and path == "/api/bfs":
            s = arg("from")
            need(s)
            seen, order, dq = {s}, [], deque([s])
            while dq:
                x = dq.popleft()
                order.append(x)
                for y in sorted(out[x]):
                    if y not in seen:
                        seen.add(y)
                        dq.append(y)
            return 200, {"order": order}
        if method == "GET" and path == "/api/topo":
            indeg = {n: 0 for n in out}
            for adj in out.values():
                for v in adj:
                    indeg[v] += 1
            heap = [n for n, d in indeg.items() if d == 0]
            heapq.heapify(heap)
            order = []
            while heap:
                x = heapq.heappop(heap)
                order.append(x)
                for v in out[x]:
                    indeg[v] -= 1
                    if indeg[v] == 0:
                        heapq.heappush(heap, v)
            if len(order) < len(out):
                raise HTTPError(409, "the graph has a cycle")
            return 200, {"order": order}
        if method == "GET" and path == "/api/path":
            s, t = arg("from"), arg("to")
            need(s)
            need(t)
            dist, prev, pq = {s: 0}, {}, [(0, s)]
            while pq:
                d, x = heapq.heappop(pq)
                if d > dist[x]:
                    continue
                for y, w in out[x].items():
                    if d + w < dist.get(y, float("inf")):
                        dist[y], prev[y] = d + w, x
                        heapq.heappush(pq, (d + w, y))
            if t not in dist:
                raise HTTPError(404, "unreachable")
            p = [t]
            while p[-1] != s:
                p.append(prev[p[-1]])
            return 200, {"path": p[::-1], "distance": dist[t]}
        raise HTTPError(404, "not found")
    return handle


HANDLE = {"rbtree": rbtree_app, "linked-list": list_app, "digraph": graph_app}[TASK]()


class H(BaseHTTPRequestHandler):
    def go(self):
        u = urlparse(self.path)
        if self.command == "GET" and u.path in ("/", "/index.html"):
            raw = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ui", TASK + ".html"), "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(n) or b"null") if n else None
            except ValueError:
                raise HTTPError(400, "body is not JSON")
            status, doc = HANDLE(self.command, u.path.rstrip("/") or "/", parse_qs(u.query), body)
        except HTTPError as e:
            status, doc = e.status, {"error": e.msg}
        raw = json.dumps(doc).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    do_GET = do_POST = do_DELETE = go

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", 3000))), H).serve_forever()
PY
# One plain HTML page per task (no build step, no CDN: the sandbox has no internet at start).
mkdir -p ui
cat > ui/rbtree.html <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Red-black tree</title>
<style>
  :root { --bg: #f6f7f5; --ink: #1b1f1d; --muted: #5a625d; --line: #c9cdc7; --red: #c2412d; --blue: #2a3fb8; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { margin: 0; font-size: 28px; letter-spacing: -0.02em; }
  .stats { display: flex; gap: 20px; margin: 6px 0 20px; color: var(--muted); }
  .stats b { color: var(--ink); font-variant-numeric: tabular-nums; }
  form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  input { height: 38px; min-width: 0; flex: 1 1 220px; max-width: 360px; padding: 0 12px; border: 1px solid #858d88; border-radius: 6px; font: inherit; background: #fff; }
  button { height: 38px; padding: 0 14px; border: 1px solid var(--ink); border-radius: 6px; background: #fff; color: var(--ink); font: inherit; font-weight: 600; cursor: pointer; }
  button.primary { background: var(--ink); color: #fff; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
  .msg { min-height: 22px; margin: 10px 0; color: var(--muted); }
  .msg.err { color: var(--red); }
  .canvas { overflow-x: auto; background: #fff; border: 1px solid #dcdfda; border-radius: 8px; padding: 12px; }
  svg { display: block; margin: 0 auto; }
  .edge { stroke: var(--line); stroke-width: 1.5; }
  .node text { fill: #fff; font: 600 12px system-ui, sans-serif; text-anchor: middle; dominant-baseline: central; }
  .node.found circle { stroke: var(--blue); stroke-width: 4; }
  .empty { padding: 40px; text-align: center; color: var(--muted); }
</style>
</head>
<body>
<main>
  <h1>Red-black tree</h1>
  <div class="stats"><span>Size <b id="size">0</b></span><span>Height <b id="height">0</b></span><span>Root <b id="root">—</b></span></div>
  <form id="f">
    <input id="keys" inputmode="numeric" placeholder="Keys, e.g. 5, 17, 42" aria-label="Keys">
    <button class="primary" data-op="insert">Insert</button>
    <button data-op="delete">Delete</button>
    <button data-op="search">Search</button>
  </form>
  <div id="msg" class="msg" role="status"></div>
  <div class="canvas"><div id="tree"></div></div>
</main>
<script>
const $ = (id) => document.getElementById(id)
let found = null

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const doc = await r.json().catch(() => null)
  if (!r.ok) throw new Error((doc && doc.error) || r.status + ' ' + r.statusText)
  return doc
}

function say(text, err) { $('msg').textContent = text; $('msg').className = 'msg' + (err ? ' err' : '') }

function height(n) { return n ? 1 + Math.max(height(n.left), height(n.right)) : 0 }

// In-order position gives x, depth gives y: a tidy layout with no overlaps.
function draw(tree) {
  $('size').textContent = tree.size
  $('height').textContent = height(tree.root)
  $('root').textContent = tree.root ? tree.root.key : '—'
  if (!tree.root) { $('tree').innerHTML = '<div class="empty">The tree is empty. Insert a key.</div>'; return }
  const pos = new Map(); let i = 0
  const walk = (n, d) => { if (!n) return; walk(n.left, d + 1); pos.set(n, { x: i++, d }); walk(n.right, d + 1) }
  walk(tree.root, 0)
  const DX = 40, DY = 62, R = 16, P = 8
  const w = (i - 1) * DX + 2 * (P + R), h = (height(tree.root) - 1) * DY + 2 * (P + R)
  const X = (n) => P + R + pos.get(n).x * DX, Y = (n) => P + R + pos.get(n).d * DY
  let edges = '', nodes = ''
  const emit = (n) => {
    if (!n) return
    for (const c of [n.left, n.right]) if (c) edges += `<line class="edge" x1="${X(n)}" y1="${Y(n)}" x2="${X(c)}" y2="${Y(c)}"/>`
    const fill = n.color === 'red' ? 'var(--red)' : 'var(--ink)'
    nodes += `<g class="node${n.key === found ? ' found' : ''}"><circle cx="${X(n)}" cy="${Y(n)}" r="${R}" fill="${fill}"/><text x="${X(n)}" y="${Y(n)}">${n.key}</text></g>`
    emit(n.left); emit(n.right)
  }
  emit(tree.root)
  // Fits the width when it can; below 55% of its natural size it scrolls instead of shrinking further.
  $('tree').innerHTML = `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px;min-width:${Math.round(w * 0.55)}px;height:auto" role="img" aria-label="Red-black tree with ${tree.size} keys">${edges}${nodes}</svg>`
}

async function refresh() { draw(await api('GET', '/api/tree')) }

$('f').addEventListener('submit', (e) => e.preventDefault())
for (const b of document.querySelectorAll('button[data-op]')) {
  b.addEventListener('click', async (e) => {
    e.preventDefault()
    const keys = $('keys').value.split(/[\s,]+/).filter(Boolean).map(Number)
    if (!keys.length || keys.some((k) => !Number.isInteger(k))) return say('Enter whole numbers, separated by commas.', true)
    try {
      found = null
      if (b.dataset.op === 'search') {
        const n = await api('GET', '/api/tree/search?key=' + keys[0])
        found = n.key
        say(`Found ${n.key}, a ${n.color} node.`)
      } else {
        const r = await api('POST', '/api/tree/' + b.dataset.op, { keys })
        say(b.dataset.op === 'insert' ? `Inserted ${r.inserted} new key(s).` : `Deleted ${r.deleted} key(s).`)
      }
      await refresh()
    } catch (err) { say(err.message, true); await refresh() }
  })
}
refresh().catch((err) => say(err.message, true))
</script>
</body>
</html>
HTML
cat > ui/linked-list.html <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Doubly linked list</title>
<style>
  :root { --bg: #f6f7f5; --ink: #1b1f1d; --muted: #5a625d; --line: #dcdfda; --red: #c2412d; --blue: #2a3fb8; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { margin: 0; font-size: 28px; letter-spacing: -0.02em; }
  .stats { margin: 6px 0 20px; color: var(--muted); }
  .stats b { color: var(--ink); font-variant-numeric: tabular-nums; }
  .chain { display: flex; flex-wrap: wrap; align-items: center; row-gap: 26px; padding: 26px 16px 18px; background: #fff; border: 1px solid var(--line); border-radius: 8px; min-height: 96px; }
  .item { display: flex; align-items: center; }
  .node { position: relative; min-width: 64px; padding: 10px 14px; border: 1.5px solid var(--ink); border-radius: 6px; background: #fff; font-weight: 600; text-align: center; }
  .node .tag { position: absolute; top: -20px; left: 0; right: 0; font-size: 11px; font-weight: 600; color: var(--blue); }
  .link { width: 34px; text-align: center; color: var(--muted); font-size: 18px; line-height: 1; }
  .empty { color: var(--muted); margin: auto; }
  .controls { display: grid; gap: 12px; margin-top: 18px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
  fieldset { margin: 0; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: #fff; display: flex; flex-wrap: wrap; gap: 8px; }
  legend { padding: 0 4px; font-size: 13px; color: var(--muted); }
  input { height: 36px; min-width: 0; flex: 1 1 120px; padding: 0 10px; border: 1px solid #858d88; border-radius: 6px; font: inherit; }
  input.idx { flex: 0 1 80px; }
  button { height: 36px; padding: 0 12px; border: 1px solid var(--ink); border-radius: 6px; background: #fff; color: var(--ink); font: inherit; font-weight: 600; cursor: pointer; }
  button.primary { background: var(--ink); color: #fff; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
  .msg { min-height: 22px; margin: 10px 0 0; color: var(--muted); }
  .msg.err { color: var(--red); }
</style>
</head>
<body>
<main>
  <h1>Doubly linked list</h1>
  <div class="stats">Size <b id="size">0</b></div>
  <div id="chain" class="chain" aria-live="polite"></div>
  <div id="msg" class="msg" role="status"></div>
  <div class="controls">
    <fieldset>
      <legend>Ends</legend>
      <input id="value" placeholder="Value" aria-label="Value">
      <button class="primary" data-op="push-front">Push front</button>
      <button class="primary" data-op="push-back">Push back</button>
      <button data-op="pop-front">Pop front</button>
      <button data-op="pop-back">Pop back</button>
    </fieldset>
    <fieldset>
      <legend>By index</legend>
      <input id="ivalue" placeholder="Value" aria-label="Value to insert">
      <input id="index" class="idx" inputmode="numeric" placeholder="Index" aria-label="Index">
      <button class="primary" data-op="insert">Insert at</button>
      <button data-op="delete">Delete at</button>
    </fieldset>
    <fieldset>
      <legend>Whole list</legend>
      <button data-op="reverse">Reverse</button>
      <button data-op="clear">Clear</button>
    </fieldset>
  </div>
</main>
<script>
const $ = (id) => document.getElementById(id)
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const doc = await r.json().catch(() => null)
  if (!r.ok) throw new Error((doc && doc.error) || r.status + ' ' + r.statusText)
  return doc
}
function say(text, err) { $('msg').textContent = text; $('msg').className = 'msg' + (err ? ' err' : '') }

function draw(list) {
  $('size').textContent = list.size
  if (!list.items.length) { $('chain').innerHTML = '<span class="empty">The list is empty.</span>'; return }
  $('chain').innerHTML = list.items.map((v, i) => {
    const tag = i === 0 && i === list.items.length - 1 ? 'head · tail' : i === 0 ? 'head' : i === list.items.length - 1 ? 'tail' : ''
    const link = i < list.items.length - 1 ? '<span class="link" title="next and prev">⇄</span>' : ''
    return `<span class="item"><span class="node">${tag ? `<span class="tag">${tag}</span>` : ''}${esc(v)}</span>${link}</span>`
  }).join('')
}
async function refresh() { draw(await api('GET', '/api/list')) }

const ops = {
  'push-front': () => api('POST', '/api/list/push-front', { value: $('value').value }),
  'push-back': () => api('POST', '/api/list/push-back', { value: $('value').value }),
  'pop-front': () => api('POST', '/api/list/pop-front'),
  'pop-back': () => api('POST', '/api/list/pop-back'),
  insert: () => api('POST', '/api/list/insert', { index: Number($('index').value), value: $('ivalue').value }),
  delete: () => api('DELETE', '/api/list/items/' + encodeURIComponent($('index').value)),
  reverse: () => api('POST', '/api/list/reverse'),
  clear: () => api('POST', '/api/list/clear'),
}
for (const b of document.querySelectorAll('button[data-op]')) {
  b.addEventListener('click', async () => {
    try {
      const r = await ops[b.dataset.op]()
      say(r && r.value !== undefined ? `${b.textContent}: "${r.value}"` : `${b.textContent}: done`)
    } catch (err) { say(err.message, true) }
    await refresh().catch((err) => say(err.message, true))
  })
}
refresh().catch((err) => say(err.message, true))
</script>
</body>
</html>
HTML
cat > ui/digraph.html <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Directed graph</title>
<style>
  :root { --bg: #f6f7f5; --ink: #1b1f1d; --muted: #5a625d; --line: #dcdfda; --edge: #9aa19c; --red: #c2412d; --blue: #2a3fb8; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { margin: 0; font-size: 28px; letter-spacing: -0.02em; }
  .stats { margin: 6px 0 20px; color: var(--muted); display: flex; gap: 20px; }
  .stats b { color: var(--ink); font-variant-numeric: tabular-nums; }
  .layout { display: grid; gap: 16px; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); align-items: start; }
  @media (max-width: 760px) { .layout { grid-template-columns: 1fr; } }
  .panel { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
  .panel + .panel { margin-top: 12px; }
  h2 { margin: 0 0 8px; font-size: 14px; color: var(--muted); font-weight: 600; }
  svg { display: block; width: 100%; height: auto; }
  .edge line { stroke: var(--edge); stroke-width: 1.4; }
  .edge text { font: 600 11px system-ui, sans-serif; fill: var(--muted); paint-order: stroke; stroke: #fff; stroke-width: 4px; text-anchor: middle; dominant-baseline: central; }
  .edge.on line { stroke: var(--blue); stroke-width: 3; }
  .edge.on text { fill: var(--blue); }
  .node circle { fill: #fff; stroke: var(--ink); stroke-width: 1.5; }
  .node text { font: 600 13px system-ui, sans-serif; text-anchor: middle; dominant-baseline: central; fill: var(--ink); }
  .node.on circle { fill: var(--blue); stroke: var(--blue); }
  .node.on text { fill: #fff; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .row + .row { margin-top: 8px; }
  select, input { height: 36px; min-width: 0; padding: 0 8px; border: 1px solid #858d88; border-radius: 6px; font: inherit; background: #fff; }
  input { width: 72px; }
  button { height: 36px; padding: 0 12px; border: 1px solid var(--ink); border-radius: 6px; background: #fff; color: var(--ink); font: inherit; font-weight: 600; cursor: pointer; }
  button.primary { background: var(--ink); color: #fff; }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
  .result { margin-top: 8px; font-weight: 600; }
  .result small { font-weight: 400; color: var(--muted); }
  .msg { min-height: 22px; margin-top: 8px; color: var(--muted); }
  .err { color: var(--red); }
</style>
</head>
<body>
<main>
  <h1>Directed graph</h1>
  <div class="stats"><span>Nodes <b id="nn">0</b></span><span>Edges <b id="ne">0</b></span></div>
  <div class="layout">
    <div class="panel"><div id="drawing"></div></div>
    <div>
      <div class="panel">
        <h2>Shortest path</h2>
        <div class="row">
          <select id="from" aria-label="From"></select><span>to</span><select id="to" aria-label="To"></select>
          <button class="primary" id="go">Find</button>
        </div>
        <div class="result" id="path" aria-live="polite"></div>
      </div>
      <div class="panel">
        <h2>Traversals</h2>
        <div class="row"><span>BFS from</span><select id="bfsFrom" aria-label="BFS from"></select><button id="bfs">Run</button><button id="topo">Topological order</button></div>
        <div class="result" id="order" aria-live="polite"></div>
      </div>
      <div class="panel">
        <h2>Edit</h2>
        <div class="row"><input id="nid" placeholder="id" aria-label="New node id"><button id="addNode">Add node</button><button id="delNode">Delete node</button></div>
        <div class="row">
          <input id="ef" placeholder="from" aria-label="Edge from"><input id="et" placeholder="to" aria-label="Edge to">
          <input id="ew" placeholder="weight" inputmode="numeric" aria-label="Edge weight">
          <button id="addEdge">Add edge</button><button id="delEdge">Delete edge</button>
        </div>
        <div class="msg" id="msg" role="status"></div>
      </div>
    </div>
  </div>
</main>
<script>
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
let graph = { nodes: [], edges: [] }, onPath = []

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const doc = r.status === 204 ? null : await r.json().catch(() => null)
  if (!r.ok) throw new Error((doc && doc.error) || r.status + ' ' + r.statusText)
  return doc
}
function say(id, text, err) { $(id).innerHTML = text; $(id).classList.toggle('err', !!err) }

// Nodes on a circle in id order; edges stop at the node's rim so the arrowheads show.
function draw() {
  $('nn').textContent = graph.nodes.length
  $('ne').textContent = graph.edges.length
  const S = 440, C = S / 2, RAD = S / 2 - 34, R = 16
  const at = new Map(graph.nodes.map((n, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, graph.nodes.length)
    return [n, { x: C + RAD * Math.cos(a), y: C + RAD * Math.sin(a) }]
  }))
  const pathEdges = new Set(onPath.slice(1).map((v, i) => onPath[i] + '>' + v))
  const edges = graph.edges.map((e) => {
    const a = at.get(e.from), b = at.get(e.to)
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len
    const x1 = a.x + ux * R, y1 = a.y + uy * R, x2 = b.x - ux * (R + 2), y2 = b.y - uy * (R + 2)
    const on = pathEdges.has(e.from + '>' + e.to)
    const mx = (x1 + x2) / 2 - uy * 9, my = (y1 + y2) / 2 + ux * 9
    return `<g class="edge${on ? ' on' : ''}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#${on ? 'ahOn' : 'ah'})"/><text x="${mx}" y="${my}">${e.weight}</text></g>`
  }).join('')
  const nodes = graph.nodes.map((n) => {
    const p = at.get(n)
    return `<g class="node${onPath.includes(n) ? ' on' : ''}"><circle cx="${p.x}" cy="${p.y}" r="${R}"/><text x="${p.x}" y="${p.y}">${esc(n)}</text></g>`
  }).join('')
  $('drawing').innerHTML = `<svg viewBox="0 0 ${S} ${S}" role="img" aria-label="Graph with ${graph.nodes.length} nodes">
    <defs>
      <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--edge)"/></marker>
      <marker id="ahOn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--blue)"/></marker>
    </defs>${edges}${nodes}</svg>`
}

function fillPickers() {
  for (const id of ['from', 'to', 'bfsFrom']) {
    const keep = $(id).value
    $(id).innerHTML = graph.nodes.map((n) => `<option>${esc(n)}</option>`).join('')
    if (graph.nodes.includes(keep)) $(id).value = keep
  }
}

async function findPath() {
  onPath = []
  try {
    const r = await api('GET', `/api/path?from=${encodeURIComponent($('from').value)}&to=${encodeURIComponent($('to').value)}`)
    onPath = r.path
    say('path', `${r.path.map(esc).join(' → ')} <small>distance ${r.distance}</small>`)
  } catch (err) { say('path', esc(err.message), true) }
  draw()
}

async function refresh() {
  graph = await api('GET', '/api/graph')
  graph.nodes.sort()
  fillPickers()
  await findPath()
}

async function edit(fn, done) {
  try { await fn(); say('msg', done) } catch (err) { say('msg', esc(err.message), true) }
  await refresh()
}

$('go').onclick = findPath
$('bfs').onclick = async () => {
  try { const r = await api('GET', '/api/bfs?from=' + encodeURIComponent($('bfsFrom').value)); say('order', 'BFS: ' + r.order.map(esc).join(', ')) }
  catch (err) { say('order', esc(err.message), true) }
}
$('topo').onclick = async () => {
  try { const r = await api('GET', '/api/topo'); say('order', 'Topological: ' + r.order.map(esc).join(', ')) }
  catch (err) { say('order', 'No topological order: ' + esc(err.message), true) }
}
$('addNode').onclick = () => edit(() => api('POST', '/api/nodes', { id: $('nid').value.trim() }), 'Node added.')
$('delNode').onclick = () => edit(() => api('DELETE', '/api/nodes/' + encodeURIComponent($('nid').value.trim())), 'Node deleted.')
$('addEdge').onclick = () => edit(() => api('POST', '/api/edges', { from: $('ef').value.trim(), to: $('et').value.trim(), weight: Number($('ew').value) }), 'Edge added.')
$('delEdge').onclick = () => edit(() => api('DELETE', `/api/edges/${encodeURIComponent($('ef').value.trim())}/${encodeURIComponent($('et').value.trim())}`), 'Edge deleted.')

;(async () => {
  graph = await api('GET', '/api/graph')
  graph.nodes.sort()
  fillPickers()
  $('from').value = graph.nodes.includes('a') ? 'a' : graph.nodes[0]
  $('to').value = graph.nodes.includes('l') ? 'l' : graph.nodes[graph.nodes.length - 1]
  $('bfsFrom').value = $('from').value
  await findPath()
})().catch((err) => say('msg', esc(err.message), true))
</script>
</body>
</html>
HTML
echo "$ARENA_TASK" > TASK
printf '#!/bin/sh\ncd "$(dirname "$0")" && exec python3 server.py\n' > start.sh
echo "demo solution written for $ARENA_TASK"
