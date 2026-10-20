# Doubly linked list

Implement a doubly linked list of strings (nodes with `prev` and `next`, plus `head` and `tail`), serve it over a
JSON API, and build a page that shows it. Don't back it with an array: every operation must work on the nodes.

## Data (`/work/data`)

`items.json`: 12 strings. At startup, append them in this order.

## API contract

Checked automatically, exactly as written. Indexes are 0-based, counted from the head.

| Route | Answer |
|---|---|
| `GET /api/list` | `{"size": <n>, "items": [...]}`, head to tail (walk `next`) |
| `GET /api/list/backward` | `{"items": [...]}`, tail to head (walk `prev`) |
| `POST /api/list/push-front` | body `{"value": "<string>"}` → `{"size": <n>}`; 400 when `value` is not a non-empty string |
| `POST /api/list/push-back` | the same at the tail |
| `POST /api/list/pop-front` | removes the head → `{"value": "..."}`; 409 when the list is empty |
| `POST /api/list/pop-back` | removes the tail → `{"value": "..."}`; 409 when the list is empty |
| `POST /api/list/insert` | body `{"index": <i>, "value": "<string>"}` puts the value at position i (0 ≤ i ≤ size) → `{"size": <n>}`; 400 when i is out of range or the value is bad |
| `DELETE /api/list/items/{i}` | removes the item at i → `{"value": "..."}`; 404 when i is out of range |
| `POST /api/list/reverse` | reverses the list in place by relinking the nodes → `{"size": <n>, "items": [...]}` (head to tail) |
| `POST /api/list/clear` | empties the list → `{"size": 0}` |

## The page (`GET /`)

- Shows the list as a chain of nodes, head to tail, each value in its own box with the links between neighbours
  drawn both ways (`prev` and `next`); head and tail are marked. Values are text in the page (HTML or SVG `<text>`),
  not only pixels on a canvas.
- Controls for every operation of the API: push and pop at both ends, insert at an index, delete an index, reverse,
  clear. The chain updates after each one; an error from the API is shown, not swallowed.
- Shows the size.
- Works on a phone (390 px wide): the chain wraps or scrolls, nothing is cut off.
