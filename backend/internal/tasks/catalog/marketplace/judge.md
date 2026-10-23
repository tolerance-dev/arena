Test users: `anna.novak@example.com` / `pass001` and `boris.rossi@example.com` / `pass002` (all in `users.json`).
Known data: Vertex 4K Monitor (`p6`) has `stock: 0` and an old price (149.50, was 186.88); Acme Noise-Cancelling
Headphones (`p10`) has `stock: 1`; Acme Jump Rope (`p40`) has the most reviews (6) in `reviews.json`.

1. **Catalog (15)** — every product from the data is reachable; search by title works; filtering by category works;
   sorting by price and by rating gives the right order. Check at least one search and one sort against the data.
2. **Product page (10)** — description, price, old price crossed out when there is one, seller name, rating, stock
   and the product's reviews from `reviews.json` (open Acme Jump Rope: 6 reviews). Sold-out products are marked.
3. **Cart (15)** — add from the catalog or the product page, change quantity, remove, see the line totals and the
   total, all correct. The cart survives a page reload.
4. **Stock rules (10)** — Vertex 4K Monitor can't be added (sold out); Acme Noise-Cancelling Headphones can't go
   above quantity 1 in the cart or at checkout. Try both in the browser.
5. **Checkout and orders (15)** — signed in, checkout places an order with the right items and total, empties the
   cart, and the order shows up in the user's past orders. Stock goes down after the order. Another user (sign out,
   sign in as Boris) doesn't see Anna's orders.
6. **Sign in and out (5)** — email + password from `users.json`; a wrong password is refused with a message; cart and
   checkout ask to sign in when signed out; sign out works.
7. **Visual design (15)** — looks like a real storefront on a desktop: clear hierarchy, consistent spacing and type,
   drawn product visuals instead of empty boxes, no broken layout. Use screenshots.
8. **Mobile (10)** — at 390 px every flow above still works and nothing is cut off or overlapping; look at the
   catalog, a product page and the cart.
9. **Code and robustness (5)** — readable structure, server-side validation (quantities, stock, auth) rather than
   only in the browser, no crashes or 500s while you used it, data loaded from `/work/data` rather than copied into
   the code by hand.
