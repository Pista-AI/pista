import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "./slug.ts";

test("slugify", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
  assert.equal(slugify("  a  --  b  "), "a-b");
  assert.equal(slugify("Ünï 42"), "n-42");
});
