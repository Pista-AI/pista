import assert from "node:assert/strict";
import { test } from "node:test";
import { searchProducts } from "../src/catalog/search.ts";
import { categoryName } from "../src/catalog/categories.ts";
import { canReserve } from "../src/inventory/reservations.ts";

test("search is case-insensitive", () => {
  assert.deepEqual(searchProducts("MUG").map((p) => p.id), ["mug-01"]);
});

test("categories and stock", () => {
  assert.equal(categoryName("books"), "Books");
  assert.equal(canReserve("lamp-04", 1), false);
  assert.equal(canReserve("mug-01", 10), true);
});
