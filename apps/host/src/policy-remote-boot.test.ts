import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadManagedPolicy, type LoadedPolicy } from "./policy.ts";
import { runPolicyCheck } from "./policy-check.ts";
import { createRefresher, resolveBootPolicy } from "./policy-remote-boot.ts";
import { signBundle, verifyBundle, writeCache } from "./policy-remote.ts";

const kp = generateKeyPairSync("ed25519");
const pub = kp.publicKey.export({ type: "spki", format: "pem" }) as string;
const priv = kp.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const URL_ = "https://policy.example.com/p.json";
const bundle = (serial: number, mode = "read-only") => signBundle(JSON.stringify({ version: 1, serial, locked: { approvalMode: mode } }), priv);
const reply = (body: string): typeof fetch => async () => new Response(body);
const down: typeof fetch = async () => { throw new Error("offline"); };
const dir = () => mkdtempSync(join(tmpdir(), "pista-boot-"));
const boot = (policySource?: unknown): LoadedPolicy => loadManagedPolicy({ PISTA_POLICY_FILE: "/p.json" }, "linux", { exists: () => true, read: () => JSON.stringify({ version: 1, locked: { approvalMode: "full-access" }, ...(policySource ? { policySource } : {}) }) });
const src = { url: URL_, publicKey: pub };

test("remote policy replaces the bootstrap policy", async () => {
  const r = await resolveBootPolicy({ env: {}, loaded: boot(src), cacheDir: dir(), fetch: reply(bundle(2)) });
  assert.equal(r.failure, undefined);
  assert.equal(r.loaded.policy?.locked?.approvalMode, "read-only");
  assert.equal(r.loaded.sourceKind, "url");
  assert.match(r.loaded.source!, /serial 2/);
  assert.equal(r.serial, 2);
});

test("fetch failure uses a valid cache", async () => {
  const cacheDir = dir();
  writeCache(cacheDir, bundle(4));
  const r = await resolveBootPolicy({ env: {}, loaded: boot(src), cacheDir, fetch: down });
  assert.equal(r.origin, "cache");
  assert.equal(r.serial, 4);
  assert.equal(r.loaded.policy?.locked?.approvalMode, "read-only");
});

test("failure: fatal with PISTA_REQUIRE_POLICY=1, bootstrap plus warning without", async () => {
  const req = await resolveBootPolicy({ env: { PISTA_REQUIRE_POLICY: "1" }, loaded: boot(src), cacheDir: dir(), fetch: down });
  assert.match(req.failure!, /policy URL/);
  const soft = await resolveBootPolicy({ env: {}, loaded: boot(src), cacheDir: dir(), fetch: down });
  assert.equal(soft.failure, undefined);
  assert.equal(soft.loaded.policy?.locked?.approvalMode, "full-access");
  assert.match(soft.loaded.warnings.join(" "), /keeping the bootstrap policy/);
});

test("the env source wins over the policy field; an env failure is a failure", async () => {
  const seen: string[] = [];
  const f: typeof fetch = async (u) => (seen.push(String(u)), new Response(bundle(1)));
  const r = await resolveBootPolicy({ env: { PISTA_POLICY_URL: "https://env.example.com/p", PISTA_POLICY_PUBLIC_KEY: pub }, loaded: boot(src), cacheDir: dir(), fetch: f });
  assert.deepEqual(seen, ["https://env.example.com/p"]);
  assert.equal(r.serial, 1);
  const bad = await resolveBootPolicy({ env: { PISTA_POLICY_URL: "https://env.example.com/p" }, loaded: boot(), cacheDir: dir() });
  assert.ok(bad.failure);
});

test("PISTA_REQUIRE_POLICY with no bootstrap file is satisfied by an env remote source; other bootstrap failures are not", async () => {
  const none = loadManagedPolicy({ PISTA_REQUIRE_POLICY: "1" }, "linux", { exists: () => false, read: () => "" });
  assert.ok(none.failure && none.missing);
  const env = { PISTA_REQUIRE_POLICY: "1", PISTA_POLICY_URL: URL_, PISTA_POLICY_PUBLIC_KEY: pub };
  const ok = await resolveBootPolicy({ env, loaded: none, cacheDir: dir(), fetch: reply(bundle(5)) });
  assert.equal(ok.failure, undefined);
  assert.equal(ok.loaded.failure, undefined);
  assert.equal(ok.serial, 5);
  const down1 = await resolveBootPolicy({ env, loaded: none, cacheDir: dir(), fetch: down });
  assert.match(down1.failure!, /policy URL/);
  const noEnv = await resolveBootPolicy({ env: { PISTA_REQUIRE_POLICY: "1" }, loaded: none, cacheDir: dir() });
  assert.ok(noEnv.failure);
  const broken = loadManagedPolicy({ PISTA_POLICY_FILE: "/b.json" }, "linux", { exists: () => true, read: () => "{" });
  assert.ok(broken.failure && !broken.missing);
  assert.ok((await resolveBootPolicy({ env, loaded: broken, cacheDir: dir(), fetch: reply(bundle(5)) })).failure);
});

test("no source configured leaves the bootstrap policy alone", async () => {
  const loaded = boot();
  assert.equal((await resolveBootPolicy({ env: {}, loaded, cacheDir: dir() })).loaded, loaded);
});

test("refresh tick announces a higher serial once, ignores an equal one, never throws", async () => {
  const cacheDir = dir();
  const logs: string[] = [];
  let body = bundle(3);
  const tick = createRefresher({ source: { ...src, refreshMinutes: 60 }, cacheDir, serial: 3, fetch: async () => new Response(body), log: (l) => logs.push(l) });
  await tick();
  assert.equal(logs.length, 0);
  body = bundle(4);
  await tick();
  await tick();
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, /serial 4; restart Pista/);
  const bad = createRefresher({ source: { ...src, refreshMinutes: 60 }, cacheDir: "/dev/null/x", serial: 9, fetch: down, log: (l) => logs.push(l) });
  await bad();
});

const sink = () => { const lines: string[] = []; return { lines, out: { log: (t: string) => lines.push(t), error: (t: string) => lines.push(t) } }; };
const policyEnv = (extra: NodeJS.ProcessEnv = {}) => {
  const d = dir();
  const file = join(d, "policy.json");
  writeFileSync(file, JSON.stringify({ version: 1, policySource: { url: URL_, publicKey: pub } }));
  return { PISTA_POLICY_FILE: file, ...extra };
};

test("policy check reports a live remote resolve, and a failure", async () => {
  const ok = sink();
  assert.equal(await runPolicyCheck(["policy", "check", "--json"], policyEnv(), ok.out, { fetch: reply(bundle(7)), cacheDir: dir() }), 0);
  const json = JSON.parse(ok.lines.join("\n"));
  assert.deepEqual(json.remote, { url: URL_, origin: "fetched", serial: 7 });
  assert.equal(json.sourceKind, "url");
  const warn = sink();
  assert.equal(await runPolicyCheck(["policy", "check", "--json"], policyEnv(), warn.out, { fetch: down, cacheDir: dir() }), 2);
  assert.ok(JSON.parse(warn.lines.join("\n")).remote.error);
  const fatal = sink();
  assert.equal(await runPolicyCheck(["policy", "check"], policyEnv({ PISTA_REQUIRE_POLICY: "1" }), fatal.out, { fetch: down, cacheDir: dir() }), 1);
});

test("policy sign writes an envelope that verifyBundle accepts", async () => {
  const d = dir();
  writeFileSync(join(d, "key.pem"), priv);
  writeFileSync(join(d, "p.json"), JSON.stringify({ version: 1, serial: 1 }));
  const s = sink();
  assert.equal(await runPolicyCheck(["policy", "sign", "--key", join(d, "key.pem"), "--out", join(d, "b.json"), join(d, "p.json")], {}, s.out), 0);
  assert.ok(verifyBundle(readFileSync(join(d, "b.json"), "utf8"), pub).ok);
  assert.equal(await runPolicyCheck(["policy", "sign", "--key", join(d, "missing.pem"), join(d, "p.json")], {}, s.out), 1);
});

test("sign refuses bad usage, --out equal to the key, and a payload with policySource", async () => {
  const d = dir();
  const key = join(d, "key.pem");
  writeFileSync(key, priv);
  const s = sink();
  assert.equal(await runPolicyCheck(["policy", "sign", join(d, "p.json")], {}, s.out), 64);
  writeFileSync(join(d, "p.json"), JSON.stringify({ version: 1, serial: 1 }));
  assert.equal(await runPolicyCheck(["policy", "sign", "--key", key, "--out", key, join(d, "p.json")], {}, s.out), 1);
  assert.equal(readFileSync(key, "utf8"), priv);
  writeFileSync(join(d, "chain.json"), JSON.stringify({ version: 1, serial: 1, policySource: { url: URL_, publicKey: pub } }));
  assert.equal(await runPolicyCheck(["policy", "sign", "--key", key, join(d, "chain.json")], {}, s.out), 1);
  writeFileSync(join(d, "noserial.json"), JSON.stringify({ version: 1 }));
  assert.equal(await runPolicyCheck(["policy", "sign", "--key", key, join(d, "noserial.json")], {}, s.out), 1);
});

test("an explicit missing PISTA_POLICY_FILE with REQUIRE and an env URL still fails", async () => {
  const none = loadManagedPolicy({ PISTA_POLICY_FILE: "/nope.json", PISTA_REQUIRE_POLICY: "1" }, "linux", { exists: () => false, read: () => "" });
  assert.ok(none.failure && !none.missing);
  const env = { PISTA_REQUIRE_POLICY: "1", PISTA_POLICY_URL: URL_, PISTA_POLICY_PUBLIC_KEY: pub };
  assert.ok((await resolveBootPolicy({ env, loaded: none, cacheDir: dir(), fetch: reply(bundle(1)) })).failure);
});

test("policy check lists a failure once and does not write the cache", async () => {
  const cacheDir = dir();
  const s = sink();
  assert.equal(await runPolicyCheck(["policy", "check", "--json"], policyEnv({ PISTA_REQUIRE_POLICY: "1" }), s.out, { fetch: reply(bundle(2)), cacheDir }), 0);
  assert.equal(existsSync(join(cacheDir, "policy")), false);
  const f = sink();
  await runPolicyCheck(["policy", "check", "--json"], { PISTA_REQUIRE_POLICY: "1", PISTA_POLICY_FILE: "/nope.json" }, f.out, { cacheDir });
  const fatal: string[] = JSON.parse(f.lines.join("\n")).fatal;
  assert.equal(fatal.length, new Set(fatal).size);
});
