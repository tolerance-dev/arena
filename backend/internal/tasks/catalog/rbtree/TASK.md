# Red-black tree

Implement a red-black tree of integer keys (a self-balancing binary search tree) and serve it over a JSON API.

## Data (`/work/data`)

`keys.json`: 40 distinct integers. At startup, insert them into an empty tree in this order.

## API contract

Checked automatically, exactly as written.

| Route | Answer |
|---|---|
| `GET /api/tree` | `{"size": <n>, "root": <node or null>}`; a node is `{"key": <int>, "color": "red" \| "black", "left": <node or null>, "right": <node or null>}` |
| `GET /api/tree/keys` | array of all keys in ascending order (in-order walk) |
| `GET /api/tree/search?key=K` | `{"key": K, "color": ...}`; 404 when K is not in the tree |
| `POST /api/tree/insert` | body `{"keys": [<int>, ...]}` inserts them in order, skipping keys already present → `{"inserted": <how many were new>, "size": <n>}`; 400 when `keys` is not an array of integers |
| `POST /api/tree/delete` | body `{"keys": [<int>, ...]}` deletes them in order, skipping missing keys → `{"deleted": <how many were removed>, "size": <n>}`; 400 like insert |

After every operation the tree returned by `GET /api/tree` must be a valid red-black tree: a binary search tree, the
root is black, a red node has no red child, and every path from a node down to a missing child passes the same
number of black nodes. Inserts and deletes must keep it balanced with rotations and recolouring (no rebuilding the
whole tree).
