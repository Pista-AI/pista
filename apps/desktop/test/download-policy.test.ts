import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { confineDownload, protectedDirsFor, sealedDirsFor } from "../src/download-policy.ts";

const base = realpathSync(mkdtempSync(path.join(tmpdir(), "dl-policy-")));
const home = path.join(base, "home");
const proj = path.join(home, "work", "proj");
mkdirSync(proj, { recursive: true });
mkdirSync(path.join(home, ".ssh"), { recursive: true });
const ctx = { home, protectedDirs: protectedDirsFor({ userData: path.join(home, "ud"), clientHome: path.join(home, "pistahome") }), sealedDirs: sealedDirsFor({ home, clientHome: path.join(home, "pistahome") }) };
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

test("refuses hidden and tooling folders anywhere below the root", () => {
  for (const sub of [".git/x.pdf", "a/.hidden/x.pdf", ".vscode/x.pdf", ".husky/x.pdf", "node_modules/x.pdf", "a/Node_Modules/x.pdf"]) assert.equal(ok(path.join(proj, sub)), undefined, sub);
  assert.ok(ok(path.join(proj, "report..pdf")));
});

test("refuses names Windows would reinterpret", () => {
  for (const name of ["a.pdf.", "a.pdf ", "a:stream.pdf", "CON", "con.pdf", "Nul.txt", "COM1.pdf", "lpt9.csv", "aux"]) assert.equal(ok(path.join(proj, name)), undefined, name);
  assert.equal(ok(path.join(proj, "nul", "a.pdf")), undefined);
  assert.ok(ok(path.join(proj, "console.pdf")));
});

test("refuses the extended executable and script extensions, but may replace an existing file", () => {
  for (const ext of [".lnk", ".vbs", ".hta", ".py", ".url", ".iso", ".docm", ".desktop", ".workflow", ".drv"]) assert.equal(ok(path.join(proj, `a${ext}`)), undefined, ext);
  writeFileSync(path.join(proj, "again.pdf"), "x");
  assert.ok(ok(path.join(proj, "again.pdf")));
});

test("case differences do not slip past the checks on case-insensitive platforms", () => {
  // The folders exist in lower case; the policy context spells them in upper case, as a user or a drive letter might.
  mkdirSync(path.join(home, ".ssh", "p"), { recursive: true });
  mkdirSync(path.join(home, "pistahome", "pi"), { recursive: true });
  const upper = { ...ctx, home: home.toUpperCase(), sealedDirs: ctx.sealedDirs.map((d) => d.toUpperCase()) };
  const mac = { ...upper, platform: "darwin" as const };
  assert.equal(confineDownload(path.join(home, ".ssh", "p", "a.pdf"), path.join(home, ".ssh", "p"), mac), undefined);
  assert.equal(confineDownload(path.join(home, "pistahome", "pi", "a.pdf"), path.join(home, "pistahome", "pi"), mac), undefined);
  // A case-sensitive platform compares exactly, so the same upper-case spelling does not match: folding is what catches it above.
  assert.ok(confineDownload(path.join(home, ".ssh", "p", "a.pdf"), path.join(home, ".ssh", "p"), { ...upper, platform: "linux" as const }));
});

test("the pi folder under the client home is sealed, the rest of the client home is not", () => {
  mkdirSync(path.join(home, "pistahome", "pi", "sessions"), { recursive: true });
  assert.equal(ok(path.join(home, "pistahome", "pi", "a.pdf"), path.join(home, "pistahome", "pi")), undefined);
  assert.equal(ok(path.join(home, "pistahome", "pi", "sessions", "a.pdf"), path.join(home, "pistahome", "pi", "sessions")), undefined);
  assert.equal(ok(path.join(home, "pistahome", "pi", "a.pdf"), path.join(home, "pistahome")), undefined);
});

test("write-time re-check refuses a folder that became a link after arming", () => {
  const outside = path.join(base, "swapped-out");
  mkdirSync(outside);
  mkdirSync(path.join(proj, "later"));
  const target = path.join(proj, "later", "a.pdf");
  assert.ok(ok(target));
  rmSync(path.join(proj, "later"), { recursive: true });
  symlinkSync(outside, path.join(proj, "later"));
  assert.equal(ok(target), undefined);
});
