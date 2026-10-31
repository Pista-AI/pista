import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readProjectFile, resolveInProject } from "./project-files.ts";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pista-pf-"));
  const root = join(dir, "project");
  mkdirSync(join(root, "invoices"), { recursive: true });
  writeFileSync(join(root, "invoices", "manifest.json"), "[]");
  writeFileSync(join(dir, "secret.txt"), "secret");
  return { dir, root };
}

test("reads a file inside the project and reports a missing one", () => {
  const { root } = fixture();
  assert.deepEqual(readProjectFile(root, "invoices/manifest.json"), { exists: true, content: "[]" });
  assert.deepEqual(readProjectFile(root, "invoices/nope.json"), { exists: false });
});

test("rejects paths outside the project", () => {
  const { dir, root } = fixture();
  assert.throws(() => readProjectFile(root, "../secret.txt"), /outside/);
  assert.throws(() => resolveInProject(root, "invoices/../../secret.txt"), /outside/);
  assert.throws(() => resolveInProject(root, join(dir, "secret.txt")), /relative/);
  symlinkSync(join(dir, "secret.txt"), join(root, "link.txt"));
  assert.throws(() => readProjectFile(root, "link.txt"), /outside/);
});
