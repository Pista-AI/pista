import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPolicy, formatPolicyCheck } from "./policy-check.ts";
import { loadManagedPolicy, type PolicyIo } from "./policy.ts";

const FILE = "/p/policy.json";
const io = (text: string): PolicyIo => ({ exists: (p) => p === FILE, read: () => text });
const load = (browser?: unknown) => loadManagedPolicy({ PISTA_POLICY_FILE: FILE }, "linux", io(JSON.stringify({ version: 1, ...(browser === undefined ? {} : { browser }) })));

test("policy browser block: valid entries are normalized and de-duplicated", () => {
  const loaded = load({ allowedDomains: ["Example.com", "*.Docs.Example.org.", "example.com"], deniedDomains: ["bad.example.com"] });
  assert.equal(loaded.failure, undefined);
  assert.deepEqual(loaded.policy?.browser, { allowedDomains: ["example.com", "*.docs.example.org"], deniedDomains: ["bad.example.com"] });
  assert.equal(load({}).failure, undefined);
  assert.equal(load().policy?.browser, undefined);
});

test("policy browser block: unknown keys and bad entries stop the host", () => {
  const bad: [unknown, RegExp][] = [
    ["x", /"browser" must be an object/],
    [{ nope: [] }, /browser\.nope: unknown setting/],
    [{ allowedDomains: "example.com" }, /allowedDomains must be an array/],
    [{ allowedDomains: [1] }, /allowedDomains must be an array/],
    [{ deniedDomains: ["https://example.com"] }, /deniedDomains: "https:\/\/example\.com" must be a host/],
    [{ allowedDomains: ["*"] }, /must be a host/],
    [{ allowedDomains: ["example.com/path"] }, /must be a host/],
    [{ allowedDomains: [".*\\.com"] }, /must be a host/],
  ];
  for (const [value, pattern] of bad) {
    const loaded = load(value);
    assert.match(loaded.failure ?? "", pattern, JSON.stringify(value));
  }
});

test("the loader warns on a bare-TLD pattern", () => {
  assert.match(load({ allowedDomains: ["*.com"] }).warnings.join("\n"), /"\*\.com" covers a whole top-level domain/);
});

test("policy check warns on a bare-TLD pattern", () => {
  const result = checkPolicy(load({ allowedDomains: ["*.com", "example.org"] }));
  assert.equal(result.status, "warnings");
  assert.match(result.warnings.join("\n"), /"\*\.com" covers a whole top-level domain/);
});

test("policy check shows the browser block", () => {
  const result = checkPolicy(load({ allowedDomains: ["example.com"] }));
  assert.equal(result.status, "ok");
  assert.match(formatPolicyCheck(result), /browser: \{"allowedDomains":\["example\.com"\]\}/);
});
