"""Generates every task's data/*.json and task.json (the checks' expected values come from the reference
implementations below, so they are exact). Deterministic: python3 gen_data.py rewrites the same files.

task.json is generated: change titles, limits and checks here, not in the JSON.
"""
import heapq
import json
import os
import random
from collections import deque

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalog")
TIME_LIMIT_S = 600
TOKEN_BUDGET = 400_000


def write(slug, name, obj, compact=False):
    p = os.path.join(HERE, slug, name)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        if compact:
            json.dump(obj, f, separators=(",", ": "))
        else:
            json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def task_json(slug, order, title, tagline, checks):
    out = {"order": order, "title": title, "tagline": tagline,
           "time_limit_s": TIME_LIMIT_S, "token_budget": TOKEN_BUDGET, "checks": checks}
    p = os.path.join(HERE, slug, "task.json")
    with open(p, "w") as f:
        f.write("{\n")
        keys = list(out)
        for i, k in enumerate(keys):
            if k == "checks":
                f.write('  "checks": [\n')
                f.write(",\n".join("    " + json.dumps(c, ensure_ascii=False) for c in checks))
                f.write("\n  ]")
            else:
                f.write(f"  {json.dumps(k)}: {json.dumps(out[k], ensure_ascii=False)}")
            f.write(",\n" if i < len(keys) - 1 else "\n")
        f.write("}\n")


def check(name, method, path, status=None, status_in=None, body=None, expect=None):
    c = {"name": name, "method": method, "path": path}
    if body is not None:
        c["body"] = body
    if status_in:
        c["status_in"] = status_in
    else:
        c["status"] = status or 200
    if expect:
        c["expect"] = expect
    return c


def eq(path, v):
    return {"path": path, "equals": json.loads(json.dumps(v))}  # a copy: the reference lists keep changing


# ---------- rbtree: only the key set matters for the checks (the tree shape is checked by its invariants) ----------

R = random.Random(20261019)
keys = R.sample(range(1, 1000), 40)
write("rbtree", "data/keys.json", keys, compact=True)

tree = set(keys)
ascending = list(range(2000, 2200))
gone = R.sample(keys, 30) + ascending[::2] + [5000]  # 30 seed keys, every other ascending key, one missing key
checks = [
    check("seed: 40 keys, valid red-black tree", "GET", "/api/tree",
          expect=[eq("size", 40), {"path": "root", "rbtree": True}]),
    check("in-order keys", "GET", "/api/tree/keys", expect=[eq("", sorted(tree))]),
    check("search finds a key", "GET", f"/api/tree/search?key={keys[7]}", expect=[eq("key", keys[7])]),
    check("search misses → 404", "GET", "/api/tree/search?key=4242", status=404),
    check("insert skips duplicates", "POST", "/api/tree/insert", body={"keys": [keys[0], 1000, 1001]},
          expect=[eq("inserted", 2), eq("size", 42)]),
]
tree |= {1000, 1001}
tree |= set(ascending)
checks += [
    check("insert 200 ascending keys", "POST", "/api/tree/insert", body={"keys": ascending},
          expect=[eq("inserted", 200), eq("size", len(tree))]),
    check("still a red-black tree after inserts", "GET", "/api/tree",
          expect=[eq("size", len(tree)), {"path": "root", "rbtree": True}]),
]
deleted = len([k for k in gone if k in tree])
tree -= set(gone)
checks += [
    check("delete skips missing keys", "POST", "/api/tree/delete", body={"keys": gone},
          expect=[eq("deleted", deleted), eq("size", len(tree))]),
    check("still a red-black tree after deletes", "GET", "/api/tree",
          expect=[eq("size", len(tree)), {"path": "root", "rbtree": True}]),
    check("in-order keys after deletes", "GET", "/api/tree/keys", expect=[eq("", sorted(tree))]),
    check("bad body → 400", "POST", "/api/tree/insert", body={"keys": "seven"}, status=400),
    check("delete everything", "POST", "/api/tree/delete", body={"keys": sorted(tree)},
          expect=[eq("deleted", len(tree)), eq("size", 0)]),
    check("empty tree has no root", "GET", "/api/tree", expect=[eq("size", 0), eq("root", None)]),
    check("first key becomes a black root", "POST", "/api/tree/insert", body={"keys": [17]}, expect=[eq("size", 1)]),
    check("root is black", "GET", "/api/tree", expect=[eq("root.key", 17), eq("root.color", "black")]),
]
task_json("rbtree", 1, {"en": "Red-black tree", "ru": "Красно-чёрное дерево"},
          {"en": "A balanced binary search tree behind a small JSON API: insert, delete, search.",
           "ru": "Сбалансированное дерево поиска за маленьким JSON API: вставка, удаление, поиск."}, checks)

# ---------- linked-list ----------

items = ["apple", "banana", "cherry", "date", "elderberry", "fig", "grape", "honeydew", "kiwi", "lemon", "mango",
         "nectarine"]
write("linked-list", "data/items.json", items)

L = list(items)
checks = [
    check("seed, head to tail", "GET", "/api/list", expect=[eq("size", 12), eq("items", L)]),
    check("seed, tail to head", "GET", "/api/list/backward", expect=[eq("items", L[::-1])]),
]
L.insert(0, "alpha")
checks.append(check("push-front", "POST", "/api/list/push-front", body={"value": "alpha"}, status_in=[200, 201],
                    expect=[eq("size", len(L))]))
L.append("omega")
checks.append(check("push-back", "POST", "/api/list/push-back", body={"value": "omega"}, status_in=[200, 201],
                    expect=[eq("size", len(L))]))
L.insert(3, "middle")
checks += [
    check("insert at index 3", "POST", "/api/list/insert", body={"index": 3, "value": "middle"}, status_in=[200, 201],
          expect=[eq("size", len(L))]),
    check("insert past the end → 400", "POST", "/api/list/insert", body={"index": 99, "value": "x"}, status=400),
    check("insert keeps both directions", "GET", "/api/list/backward", expect=[eq("items", L[::-1])]),
]
v = L.pop(0)
checks.append(check("delete index 0", "DELETE", "/api/list/items/0", expect=[eq("value", v)]))
v = L.pop(5)
checks += [
    check("delete index 5", "DELETE", "/api/list/items/5", expect=[eq("value", v)]),
    check("delete out of range → 404", "DELETE", "/api/list/items/99", status=404),
]
v = L.pop()
checks.append(check("pop-back", "POST", "/api/list/pop-back", expect=[eq("value", v)]))
v = L.pop(0)
checks.append(check("pop-front", "POST", "/api/list/pop-front", expect=[eq("value", v)]))
L.reverse()
checks += [
    check("reverse", "POST", "/api/list/reverse", expect=[eq("items", L)]),
    check("reversed, head to tail", "GET", "/api/list", expect=[eq("size", len(L)), eq("items", L)]),
    check("reversed, tail to head", "GET", "/api/list/backward", expect=[eq("items", L[::-1])]),
    check("non-string value → 400", "POST", "/api/list/push-back", body={"value": 42}, status=400),
    check("clear", "POST", "/api/list/clear", expect=[eq("size", 0)]),
    check("pop-front on empty → 409", "POST", "/api/list/pop-front", status=409),
    check("pop-back on empty → 409", "POST", "/api/list/pop-back", status=409),
    check("push-back on empty", "POST", "/api/list/push-back", body={"value": "solo"}, status_in=[200, 201],
          expect=[eq("size", 1)]),
    check("one item, both ways", "GET", "/api/list/backward", expect=[eq("items", ["solo"])]),
]
task_json("linked-list", 2, {"en": "Doubly linked list", "ru": "Двусвязный список"},
          {"en": "Nodes with prev and next behind a small JSON API: push, pop, insert, delete, reverse.",
           "ru": "Узлы с prev и next за маленьким JSON API: push, pop, вставка, удаление, разворот."}, checks)

# ---------- digraph ----------

NODES = list("abcdefghijkl")


def make_graph(seed):
    g = random.Random(seed)
    edges = {}
    for i, u in enumerate(NODES[:-1]):  # a chain-ish DAG: every edge goes to a later letter
        for v in g.sample(NODES[i + 1:], min(2, len(NODES) - i - 1)):
            edges[(u, v)] = g.randint(1, 9)
    return edges


def dijkstra(edges, s, t):
    adj = {}
    for (u, v), w in edges.items():
        adj.setdefault(u, []).append((v, w))
    dist, ways, prev = {s: 0}, {s: 1}, {}
    pq = [(0, s)]
    done = set()
    while pq:
        d, u = heapq.heappop(pq)
        if u in done:
            continue
        done.add(u)
        for v, w in adj.get(u, []):
            nd = d + w
            if v not in dist or nd < dist[v]:
                dist[v], ways[v], prev[v] = nd, ways[u], u
                heapq.heappush(pq, (nd, v))
            elif nd == dist[v]:
                ways[v] += ways[u]
    if t not in dist:
        return None, None, 0
    path = [t]
    while path[-1] != s:
        path.append(prev[path[-1]])
    return path[::-1], dist[t], ways[t]


def bfs(nodes, edges, s):
    adj = {n: sorted(v for (u, v) in edges if u == n) for n in nodes}
    seen, order, q = {s}, [], deque([s])
    while q:
        u = q.popleft()
        order.append(u)
        for v in adj[u]:
            if v not in seen:
                seen.add(v)
                q.append(v)
    return order


def topo(nodes, edges):
    indeg = {n: 0 for n in nodes}
    for (_, v) in edges:
        indeg[v] += 1
    heap = [n for n in nodes if indeg[n] == 0]
    heapq.heapify(heap)
    order = []
    while heap:
        u = heapq.heappop(heap)
        order.append(u)
        for (x, v) in sorted(edges):
            if x == u:
                indeg[v] -= 1
                if indeg[v] == 0:
                    heapq.heappush(heap, v)
    return order if len(order) == len(nodes) else None


seed = 7
while True:
    E = make_graph(seed)
    path_al, dist_al, ways = dijkstra(E, "a", "l")
    E2 = dict(E)
    E2[("l", "m")] = 1
    path_am, dist_am, ways_am = dijkstra(E2, "a", "m")
    if path_al and ways == 1 and ways_am == 1 and len(path_al) >= 4:
        break
    seed += 1

edges_json = [{"from": u, "to": v, "weight": w} for (u, v), w in sorted(E.items())]
write("digraph", "data/graph.json", {"nodes": NODES, "edges": edges_json})
some_edge = sorted(E)[3]
c_reaches_l = "l" in bfs(NODES, E, "c")
assert c_reaches_l, "the cycle check needs c → … → l"
nodes_m = NODES + ["m"]
E3 = dict(E2)
E3[("m", "c")] = 2
assert topo(nodes_m, E3) is None
checks = [
    check("seed graph", "GET", "/api/graph", expect=[{"path": "nodes", "len": 12}, {"path": "edges", "len": len(E)}]),
    check("bfs from a", "GET", "/api/bfs?from=a", expect=[eq("order", bfs(NODES, E, "a"))]),
    check("bfs from d", "GET", "/api/bfs?from=d", expect=[eq("order", bfs(NODES, E, "d"))]),
    check("bfs from an unknown node → 404", "GET", "/api/bfs?from=zz", status=404),
    check("topological order", "GET", "/api/topo", expect=[eq("order", topo(NODES, E))]),
    check("shortest path a → l", "GET", "/api/path?from=a&to=l", expect=[eq("distance", dist_al), eq("path", path_al)]),
    check("no path l → a → 404", "GET", "/api/path?from=l&to=a", status=404),
    check("edge to an unknown node → 404", "POST", "/api/edges", body={"from": "a", "to": "zz", "weight": 1}, status=404),
    check("duplicate edge → 409", "POST", "/api/edges",
          body={"from": some_edge[0], "to": some_edge[1], "weight": 5}, status=409),
    check("self-loop → 400", "POST", "/api/edges", body={"from": "b", "to": "b", "weight": 1}, status=400),
    check("add node m", "POST", "/api/nodes", body={"id": "m"}, status_in=[200, 201]),
    check("duplicate node → 409", "POST", "/api/nodes", body={"id": "m"}, status=409),
    check("add edge l → m", "POST", "/api/edges", body={"from": "l", "to": "m", "weight": 1}, status_in=[200, 201]),
    check("shortest path a → m", "GET", "/api/path?from=a&to=m", expect=[eq("distance", dist_am), eq("path", path_am)]),
    check("add edge m → c (makes a cycle)", "POST", "/api/edges", body={"from": "m", "to": "c", "weight": 2},
          status_in=[200, 201]),
    check("topological order with a cycle → 409", "GET", "/api/topo", status=409),
    check("delete edge m → c", "DELETE", "/api/edges/m/c", status_in=[200, 204]),
    check("topological order again", "GET", "/api/topo", expect=[eq("order", topo(nodes_m, E2))]),
    check("delete a missing edge → 404", "DELETE", "/api/edges/m/c", status=404),
    check("delete node m", "DELETE", "/api/nodes/m", status_in=[200, 204]),
    check("its edges are gone", "GET", "/api/graph", expect=[{"path": "nodes", "len": 12}, {"path": "edges", "len": len(E)}]),
    check("delete a missing node → 404", "DELETE", "/api/nodes/m", status=404),
]
task_json("digraph", 3, {"en": "Directed graph", "ru": "Ориентированный граф"},
          {"en": "A weighted digraph behind a small JSON API: BFS, topological sort, shortest path.",
           "ru": "Взвешенный орграф за маленьким JSON API: обход в ширину, топосортировка, кратчайший путь."}, checks)
print("ok", "graph seed", seed, "edges", len(E), "a→l", path_al, dist_al)
