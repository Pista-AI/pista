import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { manifestMergeExtension, mergeManifest } from "./manifest.ts";

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
