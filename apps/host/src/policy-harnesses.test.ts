import assert from "node:assert/strict";
import { test } from "node:test";
import { loadManagedPolicy } from "./policy.ts";

const load = (harnesses: unknown) => loadManagedPolicy({ PISTA_POLICY_FILE: "/p/policy.json" }, "linux", { exists: () => true, read: () => JSON.stringify({ version: 1, harnesses }) });

test("harnesses section: valid values are kept", () => {
  const { policy, warnings } = load({ allow: ["sliced", "x", "x"], allowUserHarnesses: false });
  assert.deepEqual(policy?.harnesses, { allow: ["sliced", "x"], allowUserHarnesses: false });
  assert.deepEqual(warnings, []);
});

test("harnesses section: bad shapes are dropped with warnings", () => {
  assert.equal(load("sliced").policy?.harnesses, undefined);
  const a = load({ allow: "sliced", allowUserHarnesses: "no", extra: 1 });
  assert.deepEqual(a.policy?.harnesses, { allow: [] });
  assert.equal(a.warnings.length, 3);
  const b = load({ allow: ["ok", "", 3] });
  assert.deepEqual(b.policy?.harnesses, { allow: ["ok"] });
  assert.equal(b.warnings.length, 2);
});
