import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isDefaultHome } from "../src/home-policy.ts";

const root = mkdtempSync(join(tmpdir(), "pista-home-"));
const real = join(root, ".pista");
mkdirSync(real);

test("the same path and a symlink to it are the default home", () => {
  symlinkSync(real, join(root, "link"));
  assert.ok(isDefaultHome(real, real));
  assert.ok(isDefaultHome(join(root, "link"), real));
  assert.ok(isDefaultHome(join(root, "link", "."), real));
});

test("a different or not-yet-existing home is not the default", () => {
  assert.ok(!isDefaultHome(join(root, "other"), real));
  assert.ok(!isDefaultHome(join(root, "new", "deep"), real));
});

test("a missing path under a symlinked parent resolves through the parent", () => {
  symlinkSync(root, join(root, "rootlink"));
  assert.ok(isDefaultHome(join(root, "rootlink", ".pista"), real));
  assert.ok(isDefaultHome(join(root, "rootlink", "nope", ".."), root));
});

test("an empty home counts as the default", () => {
  assert.ok(isDefaultHome("", real));
});

test("case differences count on macOS and Windows only", () => {
  const upper = join(root, ".PISTA");
  assert.ok(isDefaultHome(upper, real, "darwin"));
  assert.ok(isDefaultHome(upper, real, "win32"));
  if (process.platform === "linux") assert.ok(!isDefaultHome(upper, real, "linux"));
});
