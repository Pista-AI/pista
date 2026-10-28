import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { splitBill } from "./src/index.ts";

test("shares add up, differ by at most a cent, extras go first", () => {
  assert.deepEqual(splitBill(100, 3), [34, 33, 33]);
  assert.deepEqual(splitBill(10000, 3), [3334, 3333, 3333]);
  assert.deepEqual(splitBill(1000, 4), [250, 250, 250, 250]);
  assert.deepEqual(splitBill(7, 5), [2, 2, 1, 1, 1]);
  assert.deepEqual(splitBill(2, 3), [1, 1, 0]);
  assert.deepEqual(splitBill(0, 2), [0, 0]);
  assert.deepEqual(splitBill(999, 1), [999]);
});

test("every split is exact for a sweep of totals and group sizes", () => {
  for (let total = 0; total < 300; total += 7) {
    for (let parts = 1; parts <= 9; parts++) {
      const shares = splitBill(total, parts);
      assert.equal(shares.length, parts);
      assert.equal(shares.reduce((a, b) => a + b, 0), total);
      assert.ok(Math.max(...shares) - Math.min(...shares) <= 1);
      assert.deepEqual(shares, [...shares].sort((a, b) => b - a));
    }
  }
});

test("invalid group sizes throw RangeError", () => {
  for (const parts of [0, -2, 1.5, Number.NaN]) assert.throws(() => splitBill(100, parts), RangeError);
});

test("splitBill reuses the existing allocate helper instead of re-implementing it", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.name.endsWith(".ts")) files.push(join(dir, e.name));
    }
  };
  walk("src");
  const split = readFileSync("src/billing/split.ts", "utf8");
  assert.match(split, /import\s*\{[^}]*\ballocate\b[^}]*\}\s*from\s*["'][^"']*lib\/allocate\.ts["']/, "imports allocate from lib/allocate.ts");
  assert.match(split, /\ballocate\(/, "calls allocate");
  assert.doesNotMatch(split, /Math\.(floor|trunc|round|ceil)\(/, "does no rounding of its own");
  const definers = files.filter((f) => /(function\s+allocate\b|const\s+allocate\b)/.test(readFileSync(f, "utf8")));
  assert.deepEqual(definers, [join("src", "lib", "allocate.ts")], "allocate is defined once");
  const copies = files.filter((f) => f !== join("src", "lib", "allocate.ts") && /\bremainder\b/.test(readFileSync(f, "utf8")));
  assert.deepEqual(copies, [], "no second remainder-distribution loop");
});
