import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { confineDownload, protectedDirsFor, sealedDirsFor } from "../src/download-policy.ts";

const base = realpathSync(mkdtempSync(path.join(tmpdir(), "dl-policy-")));
const home = path.join(base, "home");
const proj = path.join(home, "work", "proj");
mkdirSync(proj, { recursive: true });
mkdirSync(path.join(home, ".ssh"), { recursive: true });
const ctx = { home, protectedDirs: protectedDirsFor({ userData: path.join(home, "ud"), clientHome: path.join(home, "pistahome") }), sealedDirs: sealedDirsFor({ home }) };
const ok = (p: string, root = proj) => confineDownload(p, root, ctx);

test("accepts a new file below the project folder, including missing subfolders", () => {
  assert.equal(ok(path.join(proj, "out", "a.pdf")), path.join(proj, "out", "a.pdf"));
});

test("refuses the root itself, paths outside it and .. escapes", () => {
  assert.equal(ok(proj), undefined);
  assert.equal(ok(path.join(proj, "..", "escape.pdf")), undefined);
  assert.equal(ok(path.join(home, "other.pdf")), undefined);
  assert.equal(ok("relative/a.pdf"), undefined);
  assert.equal(confineDownload(1, proj, ctx), undefined);
});

test("refuses a symlinked folder or file that leads out of the root", () => {
  const outside = path.join(base, "outside");
  mkdirSync(outside);
  symlinkSync(outside, path.join(proj, "link"));
  assert.equal(ok(path.join(proj, "link", "a.pdf")), undefined);
  writeFileSync(path.join(outside, "victim.pdf"), "x");
  symlinkSync(path.join(outside, "victim.pdf"), path.join(proj, "v.pdf"));
  assert.equal(ok(path.join(proj, "v.pdf")), undefined);
});

test("refuses roots that are, contain or sit inside protected folders", () => {
  for (const root of [home, base, path.dirname(home), path.join(home, ".ssh"), path.join(home, "ud")]) {
    mkdirSync(root, { recursive: true });
    assert.equal(ok(path.join(root, "a.pdf"), root), undefined, root);
  }
  mkdirSync(path.join(home, ".ssh", "p"), { recursive: true });
  assert.equal(ok(path.join(home, ".ssh", "p", "a.pdf"), path.join(home, ".ssh", "p")), undefined);
  assert.equal(ok(path.join(proj, "a.pdf"), path.join(base, "missing-root")), undefined);
  // A project folder inside the client home or app data folder is allowed; one inside a sealed folder is not.
  mkdirSync(path.join(home, "pistahome", "proj"), { recursive: true });
  assert.ok(ok(path.join(home, "pistahome", "proj", "a.pdf"), path.join(home, "pistahome", "proj")));
});

test("refuses unsafe file names", () => {
  for (const name of [".hidden.pdf", "bad\u0000.pdf", "bad\n.pdf", "run.sh", "x.EXE", "x.app", "x.js", "x.dmg"]) assert.equal(ok(path.join(proj, name)), undefined, JSON.stringify(name));
  assert.ok(ok(path.join(proj, "invoice-2026-01.pdf")));
  assert.ok(ok(path.join(proj, "data.csv")));
});
