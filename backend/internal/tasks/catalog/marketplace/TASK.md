# Marketplace

Build an online marketplace: a storefront where people browse products from several sellers, put them in a cart and
place orders.

## What people should be able to do

- Browse the catalog: search, filter by category, sort by price or rating.
- Open a product: description, price (and the old price when there is one), seller, rating and reviews, stock.
- Add to the cart, change quantities, see the total; check out. You can't buy more than is in stock, and a product
  with `stock: 0` is sold out.
- See their past orders.
- Sign in and out as one of the users in `users.json` (email + password). The cart and orders need a signed-in user.

## Data (`/work/data`)

`products.json` (60 products, prices in USD), `categories.json`, `sellers.json`, `reviews.json`, `users.json`.

## The home page

Right after start it shows the catalog with every category name from `categories.json` on the page.

## Pages

These addresses open directly (a deep link or a reload works, not only clicking through from `/`) and show the
content from the first paint after load:

- `/` — the home page.
- `/search?q=set` — the products whose title contains the text, with their prices.
- `/products/p40` — the product `p40`: title, price, seller's name, its reviews.
- `/cart` — the signed-in user's cart: each product with a **Quantity** field or **+** / **−** buttons (a new quantity
  updates the total) and a **Checkout** button that places the order (no extra form; a confirmation step is fine).
- `/orders` — the signed-in user's orders, each with its products' titles and its total.

Every page has the search box and **Sign in** in its header (signed in: **Sign out**, there or in the account menu); a
product page has an **Add to cart** button.

## API

The site's own frontend may call whatever it likes, but the app must also serve this JSON API. Extra fields are
fine; the listed ones must be there with these names. Prices and totals are numbers in USD, rounded to cents.

- `GET /api/products?q=&category=&sort=` → `{"products": [...]}`: every product, or only those whose `title`
  contains `q` (case-insensitive) and whose `category` is `category` (both optional, together they narrow down).
  Each item: `id`, `title`, `category`, `price`, `old_price`, `rating`, `reviews_count`, `stock`, `seller_id`.
  Optional `sort=price` (cheapest first), `price_desc` or `rating` (best first).
- `GET /api/products/{id}` → the product's fields plus `seller` (`id`, `name`, `rating`) and `reviews`: its reviews
  from `reviews.json` (`id`, `rating`, `text`). `stock` is what is left now. Unknown product → `404`.
- `POST /api/login` `{"email", "password"}` → `{"token"}`; wrong email or password → `401`. The cart and orders
  take `Authorization: Bearer <token>`; without it → `401`. Every user has a cart of their own.
- `GET /api/cart` → `{"items": [...], "total"}`: each item `product_id`, `title`, `price`, `quantity`,
  `subtotal` (price × quantity); `total` is the sum of the subtotals.
- `POST /api/cart` `{"product_id", "quantity"}` → sets that product's quantity in the cart (`0` removes it) and
  answers with the whole cart as above. More than `stock` (so any quantity of a sold-out product) → `409`; unknown
  product → `404`; a negative or non-integer quantity → `400`.
- `POST /api/orders` → checks out the cart: `201` with the order `id`, `items` (`product_id`, `price`, `quantity`)
  and `total`; the stock of each product goes down by its quantity and the cart is emptied. Empty cart → `400`;
  someone bought the stock in the meantime (a quantity is now more than `stock`) → `409`, and nothing is ordered.
- `GET /api/orders` → `{"orders": [...]}`: the signed-in user's orders, with the same fields.

## How it is checked

On a fresh start of the app, in this order:

1. About thirty checks of the API above (search, filters and sorting against the data, product pages, carts and
   stock, two users buying the last item, checkout, who sees which orders) and of the pages above rendering the
   right data.
2. A robot clicks through the main flows in a real browser (Chromium, 1280×800) like a person would, each step a
   check:
   - **Search**: on `/` it types a word into the search box (a field labelled "Search", or the one a **Search** button
     or link opens) and presses Enter: the matching products show up, the others don't.
   - **Sign in**: on `/` it clicks a **Sign in** (or **Log in**) button or link, fills the email and password fields of
     the form that opens (or of the page it leads to) and presses Enter. Then **Sign out** (or **Log out**) is there,
     also after a reload: on the page, or in the menu that a button with the user's name (or "Account") opens.
   - **Buying**: on `/products/{id}` it clicks **Add to cart**; the product is in `/cart`; it makes the quantity 2
     (types 2 into the **Quantity** field, or clicks **+** once) and the total updates; it clicks **Checkout** (then
     **Confirm** or **Place order** if a confirmation shows up); the order is in `/orders` and the cart is empty.
   - **Sign out**: it clicks **Sign out**, and **Sign in** shows up again, also after a reload, and `/orders` shows no
     orders.

Buttons and links are found by their text or `aria-label` (case doesn't matter), fields by their label, placeholder,
`name` or `aria-label`; the robot waits a few seconds for each text to show up, accepts browser dialogs (`confirm`) and
signs in as a user of its own from `users.json`. A step that needs an earlier one (no cart without signing in) fails
with it.

The score is half the share of the API and page checks passed plus half the share of the browser checks passed; 0 if the
app doesn't start. The pages are screenshotted on a desktop and a phone, and people compare apps built by different
agents side by side in blind votes.
