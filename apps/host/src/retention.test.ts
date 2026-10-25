import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { noopAudit, type AuditSink } from "./audit.ts";
import { deleteFile, purgeTraces, runPurge, startRetention, type PurgeStats, type PurgeTarget } from "./retention.ts";
import { loadManagedPolicy, type PolicyIo } from "./policy.ts";

const DAY = 86_400_000;
const age = (file: string, days: number) => utimesSync(file, new Date(Date.now() - days * DAY), new Date(Date.now() - days * DAY));
const home = () => mkdtempSync(join(tmpdir(), "pista-retention-"));
const fresh = (): PurgeStats => ({ threads: 0, traces: 0, skipped: 0 });

test("traces older than traceDays are deleted, newer ones kept", () => {
  const h = home();
  const dir = join(h, "browser-traces");
  mkdirSync(dir);
  for (const name of ["old.jsonl", "new.jsonl", "notes.txt"]) writeFileSync(join(dir, name), "{}\n");
  age(join(dir, "old.jsonl"), 40);
  age(join(dir, "notes.txt"), 40);
  const stats = fresh();
  purgeTraces(h, Date.now() - 30 * DAY, stats);
  assert.equal(stats.traces, 1);
  assert.ok(!existsSync(join(dir, "old.jsonl")));
  assert.ok(existsSync(join(dir, "new.jsonl")));
  assert.ok(existsSync(join(dir, "notes.txt")));
});

test("deleteFile only removes .jsonl files inside its root", () => {
  const h = home();
  const sessions = join(h, "pi", "sessions");
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, "s.jsonl"), "{}");
  for (const name of ["config.json", "auth.json"]) writeFileSync(join(h, name), "{}");
  writeFileSync(join(h, "pi", "stray.jsonl"), "{}");
  assert.equal(deleteFile(join(h, "config.json"), h), false);
  assert.equal(deleteFile(join(h, "pi", "auth.json"), sessions), false);
  assert.equal(deleteFile(join(h, "auth.json"), sessions), false);
  assert.equal(deleteFile(join(h, "pi", "stray.jsonl"), sessions), false); // a .jsonl, but not under the sessions dir
  assert.ok(existsSync(join(h, "config.json")) && existsSync(join(h, "pi", "stray.jsonl")));
  assert.equal(deleteFile(join(sessions, "s.jsonl"), sessions), true);
  assert.ok(!existsSync(join(sessions, "s.jsonl")));
});

test("a symlink escaping PISTA_HOME is not followed or removed", () => {
  const h = home();
  const outside = home();
  const secret = join(outside, "secret.jsonl");
  writeFileSync(secret, "keep");
  mkdirSync(join(h, "browser-traces"));
  symlinkSync(secret, join(h, "browser-traces", "link.jsonl"));
  const stats = fresh();
  purgeTraces(h, Date.now() + DAY, stats);
  assert.equal(stats.traces, 0);
  assert.equal(stats.skipped, 1);
  assert.ok(existsSync(secret));
  assert.equal(deleteFile(secret, join(h, "browser-traces")), false);
  // a traces folder that is a link out of the home is refused too
  const h2 = home();
  symlinkSync(outside, join(h2, "browser-traces"));
  purgeTraces(h2, Date.now() + DAY, fresh());
  assert.ok(existsSync(secret));
});

test("runPurge: threads only when sessionDays is set; a thread failure keeps partial counts and still purges traces", async () => {
  const h = home();
  mkdirSync(join(h, "browser-traces"));
  writeFileSync(join(h, "browser-traces", "old.jsonl"), "{}");
  age(join(h, "browser-traces", "old.jsonl"), 40);
  const seen: number[] = [];
  const target: PurgeTarget = { purgeThreads: async (cutoff, stats) => (seen.push(cutoff), (stats.threads = 2), Promise.reject(new Error("boom"))) };
  const now = Date.now();
  assert.deepEqual(await runPurge({ traceDays: 7 }, target, h, noopAudit, now), { threads: 0, traces: 1, skipped: 0 });
  assert.equal(seen.length, 0);
  const stats = await runPurge({ sessionDays: 30, traceDays: 7 }, target, h, noopAudit, now);
  assert.deepEqual(stats, { threads: 2, traces: 0, skipped: 0 });
  assert.equal(seen[0], now - 30 * DAY);
});

test("runPurge survives a throwing audit sink", async () => {
  const sink: AuditSink = { ...noopAudit, emit: () => { throw new Error("audit down"); } };
  const target: PurgeTarget = { purgeThreads: async (_c, stats) => void (stats.threads = 1) };
  assert.equal((await runPurge({ sessionDays: 1 }, target, home(), sink)).threads, 1);
});

test("startRetention never overlaps runs", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const target: PurgeTarget = { purgeThreads: async () => (calls++, gate) };
  startRetention({ sessionDays: 1 }, target, home(), noopAudit);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 1);
  release();
});

const FILE = "/p/policy.json";
const load = (retention: unknown) => loadManagedPolicy({ PISTA_POLICY_FILE: FILE }, "linux", { exists: (p) => p === FILE, read: () => JSON.stringify({ version: 1, retention }) } as PolicyIo);

test("policy retention block: valid values load, unknown keys and bad bounds are fatal", () => {
  assert.deepEqual(load({ sessionDays: 30, traceDays: 7, purgeOnStartup: false }).policy?.retention, { sessionDays: 30, traceDays: 7, purgeOnStartup: false });
  assert.equal(load({}).failure, undefined);
  const bad: [unknown, RegExp][] = [
    ["x", /"retention" must be an object/],
    [{ nope: 1 }, /retention\.nope: unknown setting/],
    [{ sessionDays: 0 }, /sessionDays must be an integer from 1 to 3650/],
    [{ sessionDays: 3651 }, /integer from 1 to 3650/],
    [{ traceDays: 1.5 }, /traceDays must be an integer/],
    [{ traceDays: "7" }, /traceDays must be an integer/],
    [{ purgeOnStartup: "yes" }, /purgeOnStartup must be a boolean/],
  ];
  for (const [value, pattern] of bad) assert.match(load(value).failure ?? "", pattern, JSON.stringify(value));
});
