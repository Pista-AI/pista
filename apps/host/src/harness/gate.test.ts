import assert from "node:assert/strict";
import { test } from "node:test";
import type { ManagedPolicy } from "@pista/protocol";
import { harnessDecision } from "./gate.ts";

const policy = (harnesses?: ManagedPolicy["harnesses"]): ManagedPolicy => ({ version: 1, ...(harnesses ? { harnesses } : {}) });
const pkg = (managedPackage: boolean) => ({ package: "npm:h@1.0.0", managedPackage });
const run = (id: string, p: ManagedPolicy | undefined, selectedByPolicy = false, source: "builtin" | ReturnType<typeof pkg> = "builtin") => harnessDecision({ id, policy: p, selectedByPolicy, source });

test("no policy allows everything", () => {
  assert.deepEqual(run("sliced", undefined), { allow: true });
  assert.deepEqual(run("custom", undefined, false, pkg(false)), { allow: true });
});

test("a policy without a harnesses section allows built-ins", () => {
  assert.deepEqual(run("sliced", policy()), { allow: true });
});

test("allow list: hit passes, miss is denied", () => {
  const p = policy({ allow: ["sliced"] });
  assert.deepEqual(run("sliced", p), { allow: true });
  assert.deepEqual(run("other", p), { allow: false, rule: "harnesses.allow" });
  assert.deepEqual(run("sliced", policy({ allow: [] })), { allow: false, rule: "harnesses.allow" });
});

test("allowUserHarnesses false: only a policy-selected harness runs", () => {
  const p = policy({ allowUserHarnesses: false });
  assert.deepEqual(run("sliced", p, false), { allow: false, rule: "harnesses.allowUserHarnesses" });
  assert.deepEqual(run("sliced", p, true), { allow: true });
  assert.deepEqual(run("sliced", policy({ allowUserHarnesses: true }), false), { allow: true });
});

test("package harness needs an allow-list hit and a managed package", () => {
  assert.deepEqual(run("custom", policy({ allow: ["custom"] }), false, pkg(true)), { allow: true });
  assert.deepEqual(run("custom", policy({ allow: ["custom"] }), false, pkg(false)), { allow: false, rule: "harnesses.packageNotManaged" });
  assert.deepEqual(run("custom", policy({ allow: ["x"] }), false, pkg(true)), { allow: false, rule: "harnesses.allow" });
  assert.deepEqual(run("custom", policy(), false, pkg(true)), { allow: false, rule: "harnesses.allow" });
  assert.deepEqual(run("custom", policy({ allow: ["custom"], allowUserHarnesses: false }), false, pkg(true)), { allow: false, rule: "harnesses.allowUserHarnesses" });
});

test("solo is always allowed", () => {
  assert.deepEqual(run("solo", policy({ allow: ["sliced"], allowUserHarnesses: false })), { allow: true });
});
