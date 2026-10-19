# Marketplace

Build an online marketplace: a storefront where people browse products from several sellers, put them in a cart
and place orders. Backend and frontend, both yours.

## The product

- **Catalog:** product grid with image, title, price (and the old price when there is one), rating, stock state.
  Search by text, filter by category, sort by price and rating, pagination or infinite scroll.
- **Product page:** photo, description, seller, rating with the reviews from `data/reviews.json`, stock, add to
  cart with a quantity.
- **Cart:** change quantities, remove items, see the total. Signed-in users only.
- **Checkout:** places an order from the cart, takes the stock away, empties the cart. A product can't be bought
  beyond its stock; a product with `stock: 0` is shown as sold out and can't be added.
- **Orders:** the signed-in user's order history with items, totals and dates.
- **Sign in / sign out** with the users from `data/users.json`.

## Data (`/work/data`)

`products.json` (60 products), `categories.json`, `sellers.json`, `reviews.json`, `users.json` (email + password).
Prices are in USD.

## API contract

These routes are checked automatically, exactly as written. Add any others you need.

| Route | Answer |
|---|---|
| `GET /api/products` | `{"items": [...], "total": <n>}`. Query: `q` (text in the title), `category` (category id), `sort` (`price_asc`, `price_desc`, `rating`), `page` (from 1), `limit` (default 20). `total` counts all matches, not the page. |
| `GET /api/products/{id}` | the product object with at least the fields from `products.json`; 404 if there is no such product |
| `GET /api/categories` | array of categories |
| `POST /api/login` | body `{"email", "password"}` → `{"token"}`; 401 on wrong credentials |
| `GET /api/cart` | `{"items": [{"product_id", "qty", ...}], "total": <number>}` for the signed-in user; 401 without a token |
| `POST /api/cart/items` | body `{"product_id", "qty"}` adds to the cart; 409 when the cart would exceed the stock |
| `DELETE /api/cart/items/{product_id}` | removes the line |
| `POST /api/orders` | checks out the cart → 201 with the order `{"id", "items", "total", "created_at"}`; 409 if anything is out of stock; 400 if the cart is empty |
| `GET /api/orders` | array of the signed-in user's orders, newest first |
