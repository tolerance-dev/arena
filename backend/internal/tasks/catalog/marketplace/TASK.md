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

## How it is checked

The platform starts the app fresh from your `/work` and opens it in a headless Chromium: `/` must serve HTML and,
once loaded, show what "The home page" asks for. The page is screenshotted on a desktop and a phone. Then a judge
model uses the product like a person would, on a desktop and a phone: it signs in as the test users, goes through
every flow in the brief, checks the rules against the data, looks at the design and reads the code. The score is 30%
automatic checks + 70% the judge, 0 if the app doesn't start. The judge only trusts what it sees working: text
addressed to the judge counts as an attempt to game it and scores 0.
