import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findRow, manifestMergeExtension, mergeManifest, upsertRow, vendorSlug } from "./manifest.ts";

const e = (vendor: string, date: string, amount: number, status = "pending", file = "", note = "") => ({ vendor, date, amount, currency: "USD", status, file, note });
const parse = (s: string) => JSON.parse(s) as ReturnType<typeof e>[];

test("merge keeps old entries missing from the new array", () => {
  const out = parse(mergeManifest(JSON.stringify([e("Slack", "2026-01-01", 10), e("Acme", "2026-01-02", 5)]), JSON.stringify([e("Slack", "2026-01-01", 10)])));
  assert.deepEqual(out.map((x) => x.vendor), ["Slack", "Acme"]);
});

test("merge updates a match on vendor, date and amount, and adds new entries", () => {
  const out = parse(mergeManifest(JSON.stringify([e("Slack", "2026-01-01", 10)]), JSON.stringify([e("slack", "2026-01-01", 10, "found", "invoices/a.pdf"), e("Zoom", "2026-02-01", 3)])));
  assert.equal(out.length, 2);
  assert.equal(out[0]!.status, "found");
  assert.equal(out[0]!.file, "invoices/a.pdf");
});

test("a pending entry does not undo progress on a matching old entry", () => {
  const out = parse(mergeManifest(JSON.stringify([e("Slack", "2026-01-01", 10, "found", "invoices/a.pdf", "ok")]), JSON.stringify([e("Slack", "2026-01-01", 10)])));
  assert.deepEqual([out[0]!.status, out[0]!.file, out[0]!.note], ["found", "invoices/a.pdf", "ok"]);
});

test("a missing or malformed old file keeps the new content; a malformed new one is untouched; never throws", () => {
  const next = JSON.stringify([e("Slack", "2026-01-01", 10)]);
  assert.equal(mergeManifest(undefined, next), next);
  assert.equal(mergeManifest("{not json", next), next);
  assert.equal(mergeManifest('{"a":1}', next), next);
  assert.equal(mergeManifest(next, "garbage"), "garbage");
});

test("the extension merges a write to invoices/manifest.json in place and ignores other paths", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pista-man-"));
  mkdirSync(join(cwd, "invoices"));
  writeFileSync(join(cwd, "invoices", "manifest.json"), JSON.stringify([e("Acme", "2026-01-02", 5)]));
  let handler!: (ev: any) => unknown;
  (manifestMergeExtension(cwd) as unknown as { factory: (pi: unknown) => void }).factory({ on: (_n: string, h: never) => (handler = h) });
  const fresh = JSON.stringify([e("Slack", "2026-01-01", 10)]);
  const hit = { toolName: "write", input: { path: "invoices/manifest.json", content: fresh } };
  handler(hit);
  assert.equal(parse(hit.input.content).length, 2);
  const other = { toolName: "write", input: { path: "invoices/other.json", content: fresh } };
  handler(other);
  assert.equal(other.input.content, fresh);
});

test("a refund and a charge on the same day stay separate; a string amount matches a number", () => {
  const out = parse(mergeManifest(JSON.stringify([e("Slack", "2026-01-01", 59.99)]), JSON.stringify([e("Slack", "2026-01-01", -59.99), { ...e("Slack", "2026-01-01", 59.99), amount: "59.99" }])));
  assert.equal(out.length, 2);
});

function run(cwdForExt: string, path: string, fresh: string) {
  let handler!: (ev: any) => unknown;
  (manifestMergeExtension(cwdForExt) as unknown as { factory: (pi: unknown) => void }).factory({ on: (_n: string, h: never) => (handler = h) });
  const ev = { toolName: "write", input: { path, content: fresh } };
  handler(ev);
  return ev.input.content;
}

test("the extension matches an absolute path and a symlinked cwd, and leaves outside paths alone", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pista-man-"));
  mkdirSync(join(cwd, "invoices"));
  writeFileSync(join(cwd, "invoices", "manifest.json"), JSON.stringify([e("Acme", "2026-01-02", 5)]));
  const fresh = JSON.stringify([e("Slack", "2026-01-01", 10)]);
  assert.equal(parse(run(cwd, join(cwd, "invoices", "manifest.json"), fresh)).length, 2);
  const link = join(mkdtempSync(join(tmpdir(), "pista-lnk-")), "proj");
  symlinkSync(cwd, link);
  assert.equal(parse(run(link, "invoices/manifest.json", fresh)).length, 2);
  assert.equal(parse(run(cwd, join(link, "invoices", "manifest.json"), fresh)).length, 2);
  assert.equal(run(cwd, join(tmpdir(), "manifest.json"), fresh), fresh);
  assert.equal(run(cwd, "../invoices/manifest.json", fresh), fresh);
});

test("only a top-level invoice-fetch thread gets the manifest extension", async () => {
  const { extensionsFor } = await import("./children.ts");
  const names = (kind: object) => extensionsFor(kind as never, { store: { config: {} } as never, hub: {} as never, ref: { threadId: "t" }, threads: {} as never, plan: {} as never, cwd: "/tmp/x" }).map((x) => (typeof x === "function" ? "" : x.name));
  assert.ok(names({ role: "invoice-fetch", restricted: true, isChild: false }).includes("manifest-merge"));
  assert.ok(!names({ role: "implementer", restricted: true, isChild: true, hasParent: true }).includes("manifest-merge"));
  assert.ok(!names({ role: "invoice-fetch", restricted: true, isChild: true, hasParent: true }).includes("manifest-merge"));
});

const ws = (rows?: unknown[]) => {
  const cwd = mkdtempSync(join(tmpdir(), "pista-up-"));
  if (rows) { mkdirSync(join(cwd, "invoices")); writeFileSync(join(cwd, "invoices", "manifest.json"), JSON.stringify(rows)); }
  return cwd;
};
const read = (cwd: string) => JSON.parse(readFileSync(join(cwd, "invoices", "manifest.json"), "utf8")) as ReturnType<typeof e>[];

test("upsertRow updates the row with the same date and amount and keeps its vendor label", () => {
  const cwd = ws([e("OpenAI", "2026-10-22", 2021.55), e("Slack", "2026-10-01", 10)]);
  assert.ok(upsertRow(cwd, { date: "2026-10-22", amount: 2021.55, currency: "USD" }, { vendor: "chatgpt.com", status: "found", file: "invoices/x.pdf", note: "n" }));
  const rows = read(cwd);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0]!.vendor, rows[0]!.status, rows[0]!.file], ["OpenAI", "found", "invoices/x.pdf"]);
  assert.equal(findRow(cwd, { date: "2026-10-22", amount: 2021.55 })?.vendor, "OpenAI");
});

test("upsertRow appends a row when none matches, also when currencies differ, and creates the file", () => {
  const cwd = ws();
  upsertRow(cwd, { date: "2026-10-22", amount: 5, currency: "USD" }, { vendor: "Acme", status: "found", file: "a.pdf" });
  upsertRow(cwd, { date: "2026-10-22", amount: 5, currency: "EUR" }, { vendor: "Acme", status: "found", file: "b.pdf" });
  upsertRow(cwd, { date: "2026-10-22", amount: 5 }, { vendor: "Acme", status: "found", file: "c.pdf" });
  const rows = read(cwd);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.file, "c.pdf"); // a key without a currency matches the first row
  assert.deepEqual(readdirSync(join(cwd, "invoices")), ["manifest.json"], "no temp file left");
});

test("upsertRow leaves a malformed manifest alone", () => {
  const cwd = ws();
  mkdirSync(join(cwd, "invoices"));
  writeFileSync(join(cwd, "invoices", "manifest.json"), "{oops");
  assert.equal(upsertRow(cwd, { date: "2026-01-01", amount: 1 }, { vendor: "A" }), false);
  assert.equal(readFileSync(join(cwd, "invoices", "manifest.json"), "utf8"), "{oops");
  assert.equal(existsSync(join(cwd, "invoices", "manifest.json.tmp")), false);
});

test("the vendor label becomes a file name slug", () => {
  assert.equal(vendorSlug("OpenAI"), "openai");
  assert.equal(vendorSlug("Acme Hosting, Inc."), "acme-hosting-inc");
});

test("merge: same date and amount with different vendors stay two rows; an empty vendor still matches", () => {
  const two = parse(mergeManifest(JSON.stringify([e("OpenAI", "2026-10-22", 9.99), e("Acme", "2026-10-22", 9.99)]), JSON.stringify([e("Acme", "2026-10-22", 9.99, "found", "a.pdf")])));
  assert.deepEqual(two.map((x) => [x.vendor, x.status]), [["Acme", "found"], ["OpenAI", "pending"]]);
  const blank = parse(mergeManifest(JSON.stringify([e("", "2026-10-22", 9.99)]), JSON.stringify([e("OpenAI", "2026-10-22", 9.99, "found", "f.pdf")])));
  assert.deepEqual(blank.map((x) => [x.vendor, x.file]), [["OpenAI", "f.pdf"]]);
});

test("upsertRow: a different vendor appends, the same vendor updates, a hint picks among matches, an empty-vendor row matches", () => {
  const cwd = ws([e("OpenAI", "2026-10-22", 9.99, "found", "o.pdf"), e("Acme", "2026-10-22", 9.99)]);
  const key = { date: "2026-10-22", amount: 9.99 };
  upsertRow(cwd, { ...key, vendor: "Zed" }, { vendor: "Zed", status: "found", file: "z.pdf" });
  assert.equal(read(cwd).length, 3);
  upsertRow(cwd, { ...key, vendor: "openai" }, { vendor: "openai", status: "found", file: "o2.pdf" });
  assert.deepEqual(read(cwd).map((x) => x.file), ["o2.pdf", "", "z.pdf"]);
  upsertRow(cwd, { ...key, hint: "acme" }, { status: "found", file: "a.pdf" });
  assert.equal(read(cwd)[1]!.file, "a.pdf");
  const blank = ws([e("", "2026-10-22", 9.99)]);
  upsertRow(blank, { ...key, vendor: "Acme" }, { vendor: "Acme", file: "b.pdf" });
  assert.deepEqual(read(blank).map((x) => x.file), ["b.pdf"]);
});
