import assert from "node:assert/strict";
import { test } from "node:test";
import type { ManagedPolicy } from "@pista/protocol";
import type { AuditSink } from "./audit.ts";
import { setupHome } from "./test-helpers.ts";

setupHome("children-harness-policy");
const { ConfigStore } = await import("./config.ts");
const { Children } = await import("./children.ts");

const host = { ensure: async () => { throw new Error("not used"); }, load: async () => { throw new Error("not used"); }, summary: () => undefined, summaries: () => [] };
const storeWith = (policy: ManagedPolicy) => new ConfigStore({ policy, source: "t", sourceKind: "file", warnings: [] });
const sink = () => {
  const events: Array<{ name: string; attrs: Record<string, unknown> }> = [];
  const audit = { emit: (name: string, attrs: Record<string, unknown>) => void events.push({ name, attrs }), flush: async () => {}, dispose: async () => {}, includePrompts: false, includeToolArgs: false, secrets: [] } as unknown as AuditSink;
  return { events, audit };
};

test("a harness outside harnesses.allow runs solo and is audited; an allowed one is not", () => {
  const { events, audit } = sink();
  const store = storeWith({ version: 1, harnesses: { allow: ["solo"] } });
  store.patchConfig({ harness: "sliced" });
  const children = new Children(store, host, undefined, audit);
  const kind = children.kindOf("t1");
  assert.equal(kind.harness, undefined);
  assert.equal(kind.orchestratorMode, undefined);
  assert.deepEqual(events.map((e) => [e.name, e.attrs["harness.id"], e.attrs.decision, e.attrs["decision.rule"], e.attrs["decision.source"]]), [["pista.harness.decision", "sliced", "deny", "harnesses.allow", "policy"]]);

  const allowed = sink();
  const okStore = storeWith({ version: 1, harnesses: { allow: ["sliced"] } });
  okStore.patchConfig({ harness: "sliced" });
  assert.equal(new Children(okStore, host, undefined, allowed.audit).kindOf("t2").harness?.id, "sliced");
  assert.equal(allowed.events.length, 0);
});

test("allowUserHarnesses false denies a user-chosen harness but not a locked one", () => {
  const user = storeWith({ version: 1, harnesses: { allowUserHarnesses: false } });
  user.patchConfig({ harness: "sliced" });
  assert.equal(new Children(user, host).kindOf("t").harness, undefined);

  const locked = storeWith({ version: 1, locked: { harness: "sliced" }, harnesses: { allowUserHarnesses: false } });
  assert.equal(new Children(locked, host).kindOf("t").harness?.id, "sliced");
});

test("legacy orchestratorMode sliced is gated like harness sliced", () => {
  const { events, audit } = sink();
  const store = storeWith({ version: 1, harnesses: { allow: [] } });
  store.patchConfig({ orchestratorMode: "sliced" });
  assert.equal(new Children(store, host, undefined, audit).kindOf("t").harness, undefined);
  assert.equal(events.length, 1);
});

test("a locked solo harness overrides a user orchestratorMode sliced without an audit event", () => {
  const { events, audit } = sink();
  const store = storeWith({ version: 1, locked: { harness: "solo" }, harnesses: { allow: [] } });
  store.patchConfig({ orchestratorMode: "sliced" });
  const kind = new Children(store, host, undefined, audit).kindOf("t");
  assert.equal(kind.harness, undefined);
  assert.equal(kind.orchestratorMode, undefined);
  assert.equal(events.length, 0);
});
