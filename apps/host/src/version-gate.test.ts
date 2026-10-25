import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersions, parseVersion } from "./semver.ts";
import { blockedReason, evaluateVersionGate, resolveAppVersion, updatesSummary } from "./version-gate.ts";
import { checkPolicy, formatPolicyCheck } from "./policy-check.ts";
import { loadManagedPolicy, type PolicyIo } from "./policy.ts";

const cmp = (a: string, b: string) => Math.sign(compareVersions(parseVersion(a)!, parseVersion(b)!));

test("semver parsing accepts valid and rejects invalid versions", () => {
  for (const ok of ["0.0.0", "1.2.3", "1.2.3-beta.1", "1.2.3+build.5", "1.2.3-rc.1+x"]) assert.ok(parseVersion(ok), ok);
  for (const bad of ["v1.2.3", "1.2", "01.2.3", "1.2.3-", "1.2.3-01", "a.b.c", "", "1.2.3.4", "1.2.03", "9007199254740993.0.0", "1.0.0-alpha.01"]) assert.equal(parseVersion(bad), null, bad);
});

test("semver precedence", () => {
  assert.equal(cmp("1.2.3", "1.2.3"), 0);
  assert.equal(cmp("1.2.3+a", "1.2.3+b"), 0);
  assert.equal(cmp("1.10.0", "1.9.9"), 1);
  assert.equal(cmp("1.0.0-alpha", "1.0.0"), -1);
  assert.equal(cmp("1.0.0-1", "1.0.0-a"), -1);
  assert.equal(cmp("1.0.0-2", "1.0.0-10"), -1);
  assert.equal(cmp("1.0.0-alpha", "1.0.0-alpha.1"), -1);
  // The ordering example from semver 2.0.0 section 11.
  const order = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"];
  for (let i = 1; i < order.length; i++) assert.equal(cmp(order[i - 1]!, order[i]!), -1, `${order[i - 1]} < ${order[i]}`);
});

test("version gate", () => {
  assert.deepEqual(evaluateVersionGate("1.5.0", undefined), { status: "ok" });
  assert.equal(evaluateVersionGate("1.5.0", { minimumVersion: "1.0.0", maximumVersion: "2.0.0" }).status, "ok");
  assert.deepEqual(evaluateVersionGate("0.9.0", { minimumVersion: "1.0.0" }), { status: "below", current: "0.9.0", minimumVersion: "1.0.0" });
  assert.deepEqual(evaluateVersionGate("2.0.1", { maximumVersion: "2.0.0" }), { status: "above", current: "2.0.1", maximumVersion: "2.0.0" });
  assert.equal(evaluateVersionGate("5.0.0", { minimumVersion: "1.0.0" }).status, "ok");
  assert.equal(evaluateVersionGate("0.1.0", { maximumVersion: "1.0.0" }).status, "ok");
  assert.equal(evaluateVersionGate("1.2.3", { minimumVersion: "1.2.3", maximumVersion: "1.2.3" }).status, "ok");
  assert.equal(evaluateVersionGate("1.2.0-beta.1", { minimumVersion: "1.2.0" }).status, "below");
});

test("app version resolution", () => {
  const warnings: string[] = [];
  assert.equal(resolveAppVersion({ PISTA_APP_VERSION: "3.4.5" }), "3.4.5");
  const fallback = resolveAppVersion({});
  assert.ok(parseVersion(fallback));
  assert.equal(resolveAppVersion({ PISTA_APP_VERSION: "nope" }, (m) => warnings.push(m)), fallback);
  assert.equal(warnings.length, 1);
});

test("blocked-mode guard refuses agent work only", () => {
  const below = evaluateVersionGate("0.1.0", { minimumVersion: "0.2.0" });
  for (const method of ["thread.create", "thread.prompt", "thread.compact", "thread.goal.set", "thread.goal.resume", "thread.bash"]) assert.match(blockedReason(below, method)!, /^version_blocked: Pista 0\.1\.0 is below the minimum version 0\.2\.0/);
  for (const method of ["host.hello", "config.set", "threads.list", "thread.open", "thread.abort", "models.list"]) assert.equal(blockedReason(below, method), null);
  assert.equal(blockedReason({ status: "ok" }, "thread.prompt"), null);
  assert.match(blockedReason(evaluateVersionGate("3.0.0", { maximumVersion: "2.0.0" }), "thread.create")!, /above the maximum version 2\.0\.0/);
});

test("updates summary: the env switch only disables", () => {
  assert.deepEqual(updatesSummary(undefined, {}), { enabled: true, channel: "stable" });
  assert.equal(updatesSummary(undefined, { PISTA_DISABLE_AUTOUPDATER: "1" }).enabled, false);
  assert.equal(updatesSummary({ enabled: false }, {}).enabled, false);
  assert.equal(updatesSummary({ enabled: false }, { PISTA_DISABLE_AUTOUPDATER: "0" }).enabled, false);
  assert.deepEqual(updatesSummary({ channel: "beta", feedUrl: "https://u.example/feed", enforcementHours: 24 }, {}), { enabled: true, channel: "beta", feedUrl: "https://u.example/feed", enforcementHours: 24 });
});

const FILE = "/p/policy.json";
const io = (text: string): PolicyIo => ({ exists: (p) => p === FILE, read: () => text });
const load = (updates?: unknown) => loadManagedPolicy({ PISTA_POLICY_FILE: FILE }, "linux", io(JSON.stringify({ version: 1, ...(updates === undefined ? {} : { updates }) })));

test("policy updates block: valid, absent", () => {
  const full = { enabled: true, channel: "beta", feedUrl: "https://updates.example.com/pista", minimumVersion: "1.2.0", maximumVersion: "2.0.0-rc.1", enforcementHours: 72 };
  const loaded = load(full);
  assert.equal(loaded.failure, undefined);
  assert.deepEqual(loaded.policy?.updates, full);
  assert.equal(load().failure, undefined);
  assert.equal(load({ feedUrl: "http://localhost:8080/feed", minimumVersion: "1.0.0", maximumVersion: "1.0.0" }).failure, undefined);
  assert.equal(load({ feedUrl: "http://127.0.0.1/feed" }).failure, undefined);
  assert.equal(load({ feedUrl: "http://[::1]:9/feed" }).failure, undefined);
});

test("policy updates block: fatal problems", () => {
  const bad: [unknown, RegExp][] = [
    ["x", /"updates" must be an object/],
    [{ nope: 1 }, /updates\.nope: unknown setting/],
    [{ enabled: "yes" }, /updates\.enabled must be a boolean/],
    [{ channel: "nightly" }, /updates\.channel/],
    [{ feedUrl: "http://updates.example.com/feed" }, /updates\.feedUrl/],
    [{ feedUrl: "not a url" }, /updates\.feedUrl/],
    [{ feedUrl: 5 }, /updates\.feedUrl/],
    [{ feedUrl: "ftp://x.example/feed" }, /updates\.feedUrl/],
    [{ feedUrl: "https://user:pw@u.example/feed" }, /updates\.feedUrl/],
    [{ feedUrl: "https://u.example/feed?token=1" }, /updates\.feedUrl/],
    [{ feedUrl: "https://u.example/feed#x" }, /updates\.feedUrl/],
    [{ feedUrl: "https://u.example/feed?" }, /updates\.feedUrl/],
    [{ minimumVersion: "v1.0.0" }, /updates\.minimumVersion/],
    [{ maximumVersion: "1.0" }, /updates\.maximumVersion/],
    [{ minimumVersion: 1 }, /updates\.minimumVersion/],
    [{ minimumVersion: "2.0.0", maximumVersion: "1.0.0" }, /must not be greater/],
    [{ enforcementHours: 0 }, /enforcementHours/],
    [{ enforcementHours: 721 }, /enforcementHours/],
    [{ enforcementHours: 1.5 }, /enforcementHours/],
    [{ enforcementHours: "24" }, /enforcementHours/],
  ];
  for (const [updates, pattern] of bad) {
    const loaded = load(updates);
    assert.match(loaded.failure ?? "", pattern, JSON.stringify(updates));
    assert.equal(loaded.policy, null);
  }
});

test("policy check output shows the updates block and the version gate line", () => {
  const env = { PISTA_POLICY_FILE: FILE, PISTA_APP_VERSION: "0.1.0" };
  const out = (updates?: unknown) => formatPolicyCheck(checkPolicy(loadManagedPolicy(env, "linux", io(JSON.stringify({ version: 1, ...(updates ? { updates } : {}) }))), env, "linux", () => true));
  assert.match(out({ minimumVersion: "0.1.0", maximumVersion: "0.3.0" }), /Version gate: ok \(0\.1\.0; minimum 0\.1\.0, maximum 0\.3\.0\)/);
  assert.match(out({ minimumVersion: "0.1.0" }), /updates: \{"minimumVersion":"0\.1\.0"\}/);
  assert.match(out(), /Version gate: ok \(0\.1\.0; no version range\)/);
  assert.match(out({ minimumVersion: "0.2.0" }), /Version gate: BLOCKED \(0\.1\.0 below minimum 0\.2\.0\)/);
  const bad = checkPolicy(loadManagedPolicy(env, "linux", io("{\"version\":1}")), { ...env, PISTA_APP_VERSION: "x" }, "linux", () => true);
  assert.ok(bad.warnings.some((w) => w.includes("PISTA_APP_VERSION")));
});
