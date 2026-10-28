import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { splitBill } from "./src/index.ts";

test("BEHAVIOUR WRONG: shares add up, differ by at most a cent, extras go first", () => {
  assert.deepEqual(splitBill(100, 3), [34, 33, 33]);
  assert.deepEqual(splitBill(10000, 3), [3334, 3333, 3333]);
  assert.deepEqual(splitBill(1000, 4), [250, 250, 250, 250]);
  assert.deepEqual(splitBill(7, 5), [2, 2, 1, 1, 1]);
  assert.deepEqual(splitBill(2, 3), [1, 1, 0]);
  assert.deepEqual(splitBill(0, 2), [0, 0]);
  assert.deepEqual(splitBill(999, 1), [999]);
});

test("BEHAVIOUR WRONG: every split is exact for a sweep of totals and group sizes", () => {
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

test("BEHAVIOUR WRONG: invalid group sizes throw RangeError", () => {
  for (const parts of [0, -2, 1.5, Number.NaN]) assert.throws(() => splitBill(100, parts), RangeError);
});

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("NOT REUSED / DUPLICATED: splitBill uses the existing allocate helper", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.name.endsWith(".ts")) files.push(join(dir, e.name));
    }
  };
  walk("src");
  const helper = join("src", "lib", "allocate.ts");
  const split = strip(readFileSync(join("src", "billing", "split.ts"), "utf8"));
  // `import { allocate } from ".../lib/allocate.ts"` or from the index barrel, optionally `allocate as x`.
  const imports = [...split.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)]
    .filter((m) => /(^|\/)lib\/allocate(\.ts)?$/.test(m[2]!) || /(^|\/)index(\.ts)?$/.test(m[2]!))
    .flatMap((m) => m[1]!.split(",").map((x) => x.trim().match(/^allocate(?:\s+as\s+(\w+))?$/)))
    .filter((m): m is RegExpMatchArray => m !== null);
  assert.ok(imports.length > 0, "split.ts must import allocate from lib/allocate.ts (or the index barrel)");
  const local = imports[0]![1] ?? "allocate";
  assert.match(split, new RegExp(`\\b${local}\\(`), `split.ts must call ${local}(...)`);
  assert.doesNotMatch(split, /Math\.(floor|trunc|round|ceil)\(/, "split.ts does rounding of its own");
  const code = (f: string) => strip(readFileSync(f, "utf8"));
  const definers = files.filter((f) => /(function\s+allocate\b|const\s+allocate\b)/.test(code(f)));
  assert.deepEqual(definers, [helper], "allocate must be defined once");
  const copies = files.filter((f) => f !== helper && /\bremainder\b/.test(code(f)));
  assert.deepEqual(copies, [], "a second remainder-distribution loop was written");
});
