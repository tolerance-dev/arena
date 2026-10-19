# Directed graph

Implement a weighted directed graph (adjacency lists) with breadth-first search, topological sort and shortest paths,
and serve it over a JSON API.

## Data (`/work/data`)

`graph.json`: `{"nodes": ["a", ...], "edges": [{"from", "to", "weight"}, ...]}`. Load it at startup. Node ids are
strings; weights are positive integers.

## API contract

Checked automatically, exactly as written. Wherever the order of neighbours matters, visit them in ascending id order
so the answers are deterministic.

| Route | Answer |
|---|---|
| `GET /api/graph` | `{"nodes": [ids], "edges": [{"from", "to", "weight"}]}` |
| `POST /api/nodes` | body `{"id": "<string>"}` adds a node → 201; 409 if it exists; 400 when `id` is not a non-empty string |
| `DELETE /api/nodes/{id}` | removes the node and every edge into or out of it; 404 if there is no such node |
| `POST /api/edges` | body `{"from", "to", "weight"}` adds the edge → 201; 404 if either node is missing; 409 if the edge exists; 400 for a self-loop or a weight that is not a positive integer |
| `DELETE /api/edges/{from}/{to}` | removes the edge; 404 if there is no such edge |
| `GET /api/bfs?from=X` | `{"order": [ids]}`: the nodes reachable from X in breadth-first order, X first; 404 if X is missing |
| `GET /api/topo` | `{"order": [ids]}`: a topological order of all nodes; when several nodes are ready, take the smallest id first (Kahn's algorithm with a min-heap). 409 if the graph has a cycle |
| `GET /api/path?from=X&to=Y` | `{"path": [X, ..., Y], "distance": <sum of weights>}`: the shortest path by weight (Dijkstra); 404 if Y is unreachable or a node is missing |
