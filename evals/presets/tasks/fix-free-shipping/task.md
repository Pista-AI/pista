This repo is a small web-shop backend (`src/`, tests in `test/`). Customers report that small orders never pay shipping: a single mug sent within Sweden comes out with free shipping.
Free shipping should apply only when the order's subtotal after discounts is at least 500 SEK; below that, the normal shipping rate for the destination applies.
Find the cause and fix it. Keep the tests in `test/` passing and do not change the exports of `src/index.ts`.
