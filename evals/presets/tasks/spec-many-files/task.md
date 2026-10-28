This repo is a small pricing library (`src/`, tests in `test/`). Add currency support to `Price`, exactly as follows.

1. `Price` gets a `currency: string` field. `price(amountCents, currency = "EUR")` sets it; `zero(currency = "EUR")` likewise.
2. `add(a, b)` throws `new Error("Currency mismatch: " + a.currency + " vs " + b.currency)` when the currencies differ, e.g. exactly `Currency mismatch: EUR vs SEK`. Otherwise the result has the same currency. `sum([])` is `price(0)` (EUR).
3. `multiply`, `negate` and `percentOff` keep the currency of the price they are given, so checkout totals, line totals and refunds carry the currency of the cart's products. `cartTotal` of an empty cart is EUR zero.
4. `formatPrice(p)` returns `<amount> <currency>`, e.g. `12.50 SEK`; receipts therefore print `Mug x2  25.00 EUR` and `Total  44.90 EUR`.
5. `priceToJson` includes `currency` (`{ amountCents, currency }`); `priceFromJson` accepts JSON without a `currency` (data stored earlier) and then uses `"EUR"`.
6. `totalRevenue` throws the same `Currency mismatch: ...` error when paid orders are in different currencies (it uses `add`'s behaviour; no new function).
7. Add a SEK product to the catalog: `{ id: "kanna", name: "Kanna", price: price(14900, "SEK") }`.

Everything else keeps behaving as before: amounts, rounding, the exports of `src/index.ts` (no names added or removed) and the error for unknown products. Update the tests in `test/` that this changes and add tests for the new behaviour.
