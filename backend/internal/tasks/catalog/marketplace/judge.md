# Judge checklist: Marketplace

Test users: anna.novak@example.com / pass001, boris.berg@example.com / pass002 (see data/users.json).
The automatic checks already used greta.petrov@example.com (she bought 2 × p3), leave her alone.

## Functionality (60 points)
1. **Catalog UI (8):** the home page shows products with image, title, price, rating; sold-out products are marked.
2. **Search, filter, sort in the UI (8):** typing "keyboard" finds the keyboard; picking a category narrows the
   list; sorting by price really orders by price; results page or scroll.
3. **Product page (6):** opens from the grid; shows description, seller name (not just an id), reviews from
   reviews.json, stock.
4. **Sign in (6):** the UI signs in anna.novak, shows who is signed in, signs out; a wrong password shows an error.
5. **Cart (10):** add from the product page with a quantity, change quantity, remove, total is right; adding a
   sold-out product (e.g. p6) is impossible; going above stock is refused with a clear message.
6. **Checkout and orders (12):** placing an order empties the cart, lowers stock (check the product page and
   `GET /api/products/{id}`), and the order shows up in the history with items and total. Two orders that together
   exceed stock: the second is refused.
7. **Persistence and API hygiene (10):** state survives page reloads; protected routes return 401 without a token;
   errors are JSON with sensible statuses; bad input (negative qty, missing fields) gives 400, not 500.

## UI and UX (25 points)
8. **Desktop (10):** looks like a real store: clear layout, consistent styles, readable typography, loading and
   empty states, no broken layout.
9. **Mobile 390 px (10):** usable without horizontal scroll, tappable controls, the cart and checkout work.
10. **Polish (5):** feedback after actions (added to cart, order placed), no console errors on the main pages.

## Code (15 points)
11. **Structure (8):** backend and frontend separated sensibly, no giant single file, data loaded from /work/data.
12. **Quality (7):** input validation, no obvious security holes (passwords not returned by the API, tokens
    checked server-side), readable naming.
