import assert from "node:assert/strict";
import { test } from "node:test";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { makeManager, setupHome } from "./test-helpers.ts";

const { projectDir } = setupHome("children");
const { extensionsFor, Children } = await import("./children.ts");
const { manager, store, hub, project } = await makeManager({ projectDir });

// Pi's own extensions are bare factories; ours are named. Compare by name, with "pi" standing in for a bare factory.
const names = (list: InlineExtension[]) => list.map((e) => (typeof e === "function" ? "pi" : e.name));
const deps = { store, hub, ref: { threadId: "t" }, threads: manager, plan: { getPlan: () => undefined, setPlan: () => {} } };

test("extensionsFor: an unrestricted top-level thread gets everything, including the agent and plan tools", () => {
  assert.deepEqual(names(extensionsFor({ role: undefined, restricted: false, isChild: false }, deps)), [
    "pi", "pi", "pi", "browser", "browsing-turns", "agent-tool", "loop-guard", "abort-label", "workspace-state", "context-prune", "plan", "approvals",
  ]);
});

test("extensionsFor: browserEnabled false leaves the browser tools out and nothing else", () => {
  const before = names(extensionsFor({ role: undefined, restricted: false, isChild: false }, deps));
  store.patchConfig({ browserEnabled: false });
  try {
    assert.deepEqual(names(extensionsFor({ role: undefined, restricted: false, isChild: false }, deps)), before.filter((n) => n !== "browser"));
  } finally {
    store.patchConfig({ browserEnabled: true });
  }
});

test("extensionsFor: an implementer child keeps tools and the browser but gets no agent or plan tool, and is role-gated", () => {
  assert.deepEqual(names(extensionsFor({ role: "implementer", restricted: false, isChild: true }, deps)), [
    "pi", "pi", "pi", "browser", "browsing-turns", "role-gate", "loop-guard", "abort-label", "workspace-state", "context-prune", "approvals",
  ]);
});

test("extensionsFor: a restricted child loses codemode, tool search, MCP and the browser", () => {
  assert.deepEqual(names(extensionsFor({ role: "explorer", restricted: true, isChild: true }, deps)), [
    "role-gate", "loop-guard", "abort-label", "workspace-state", "context-prune", "approvals",
  ]);
});

test("kindOf and parentOf read threadMeta, then the loaded or indexed summary", async () => {
  const { summary: parent } = await manager.create(project.id);
  const childId = await manager.spawnChild(parent.id, { role: "explorer" });
  const children = new Children(store, {
    ensure: async () => {
      throw new Error("not used");
    },
    load: async () => {
      throw new Error("not used");
    },
    summary: (id) => (id === "indexed" ? { ...parent, id, parentId: "p" } : undefined),
    summaries: () => [],
  });
  assert.deepEqual(children.kindOf(childId), { role: "explorer", restricted: true, isChild: true });
  assert.equal(children.parentOf(childId), parent.id);
  assert.deepEqual(children.kindOf(parent.id), { role: undefined, restricted: false, isChild: false });
  assert.deepEqual(children.kindOf("indexed"), { role: undefined, restricted: false, isChild: true });
  assert.equal(children.parentOf("indexed"), "p");
});

test("lead keeps a top-level thread unrestricted and ungated; delegate-read gates it; children never get the mode", async () => {
  const { summary: parent } = await manager.create(project.id);
  const childId = await manager.spawnChild(parent.id, { role: "implementer" });
  const children = new Children(store, {
    ensure: async () => {
      throw new Error("not used");
    },
    load: async () => {
      throw new Error("not used");
    },
    summary: () => undefined,
    summaries: () => [],
  });
  try {
    store.patchConfig({ orchestratorMode: "lead" });
    const lead = children.kindOf(parent.id);
    assert.deepEqual(lead, { role: undefined, restricted: false, isChild: false, orchestratorMode: "lead" });
    const leadNames = names(extensionsFor(lead, deps));
    assert.ok(!leadNames.includes("orchestrator-gate"));
    assert.ok(leadNames.includes("browser") && leadNames.includes("agent-tool"));
    assert.equal(children.kindOf(childId).orchestratorMode, undefined);

    store.patchConfig({ orchestratorMode: "delegate-read" });
    const reader = children.kindOf(parent.id);
    assert.equal(reader.restricted, true);
    assert.ok(names(extensionsFor(reader, deps)).includes("orchestrator-gate"));
  } finally {
    store.patchConfig({ orchestratorMode: undefined });
  }
});

test("harness config key: harness sliced matches the legacy sliced mode, unknown ids run solo, solo keeps other modes", () => {
  const children = new Children(store, {
    ensure: async () => {
      throw new Error("not used");
    },
    load: async () => {
      throw new Error("not used");
    },
    summary: () => undefined,
    summaries: () => [],
  });
  try {
    store.patchConfig({ orchestratorMode: "sliced" });
    const legacy = children.kindOf("top-level");
    assert.equal(legacy.harness?.id, "sliced");
    store.patchConfig({ orchestratorMode: undefined, harness: "sliced" });
    assert.deepEqual(children.kindOf("top-level"), legacy);

    store.patchConfig({ harness: "nope" });
    assert.deepEqual(children.kindOf("top-level"), { role: undefined, restricted: false, isChild: false });

    store.patchConfig({ harness: "solo", orchestratorMode: "delegate" });
    const delegate = children.kindOf("top-level");
    assert.equal(delegate.harness, undefined);
    assert.equal(delegate.orchestratorMode, "delegate");
    assert.equal(delegate.restricted, true);
  } finally {
    store.patchConfig({ harness: undefined, orchestratorMode: undefined });
  }
});
