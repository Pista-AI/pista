import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isInvoicesPath, readProjectFile, resolveInProject, revealCommand, revealProjectInvoices } from "./project-files.ts";

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

test("a missing path under a symlinked directory is checked at its real location", () => {
  const { dir, root } = fixture();
  mkdirSync(join(dir, "outside"));
  symlinkSync(join(dir, "outside"), join(root, "linked"));
  assert.throws(() => resolveInProject(root, "linked/new/file.txt"), /outside/);
  assert.equal(resolveInProject(root, "invoices/2026-09/new.pdf").endsWith("invoices/2026-09/new.pdf"), true);
  assert.equal(isInvoicesPath(root, "invoices/2026-09/new.pdf"), true);
  assert.equal(isInvoicesPath(root, "linked/new.pdf"), false);
  assert.equal(isInvoicesPath(root, "invoices/../notes.txt"), false);
  assert.equal(isInvoicesPath(root, join(root, "invoices", "manifest.json")), true);
});

test("reveal only selects the invoices folder and never launches a .app", () => {
  const { root } = fixture();
  mkdirSync(join(root, "invoices", "evil.app"));
  assert.deepEqual(revealCommand("darwin", join(root, "invoices", "evil.app")), ["open", ["-R", join(root, "invoices", "evil.app")]]);
  const calls: [string, string[]][] = [];
  revealProjectInvoices(root, (cmd, args) => calls.push([cmd, args]));
  assert.equal(calls.length, 1);
  assert.ok(calls[0]![1].some((a) => a.endsWith("invoices")));
  assert.throws(() => revealProjectInvoices(join(root, "invoices"), () => {}), /Nothing to show/);
});
