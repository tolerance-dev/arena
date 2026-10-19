#!/bin/sh
# A pipeline smoke test: makes one LLM call through the gateway (to show up in the token count), then writes a
# hand-made reference solution for whichever task it got (Python, standard library only). No real agent work.
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
echo "$ARENA_TASK" > TASK
printf '#!/bin/sh\ncd "$(dirname "$0")" && exec python3 server.py\n' > start.sh
echo "demo solution written for $ARENA_TASK"
