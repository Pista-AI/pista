import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeManager, setupHome } from "./test-helpers.ts";

// CLIENT_DIR is read when config.ts loads, so set PISTA_HOME first and import dynamically.
const { home } = setupHome("config");
const { ConfigStore, WORKSPACE_DIR } = await import("./config.ts");

test("threadMeta get/set/delete persists across stores", () => {
  const store = new ConfigStore();
  assert.equal(store.getThreadMeta("t1"), undefined);

  store.setThreadMeta("t1", { parentId: "p1", role: "explorer" });
  assert.deepEqual(store.getThreadMeta("t1"), { parentId: "p1", role: "explorer" });

  const reloaded = new ConfigStore();
  assert.deepEqual(reloaded.getThreadMeta("t1"), { parentId: "p1", role: "explorer" });

  reloaded.deleteThreadMeta("t1");
  assert.equal(reloaded.getThreadMeta("t1"), undefined);
  const saved = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  assert.deepEqual(saved.threadMeta, {});
  assert.equal(new ConfigStore().getThreadMeta("t1"), undefined);
});

test("setProjectTrusted toggles a project both ways, persists, and rejects the default workspace", () => {
  const store = new ConfigStore();
  const project = store.addProject(home);
  assert.equal(project.trusted, undefined);

  assert.equal(store.setProjectTrusted(project.id, true).trusted, true);
  assert.equal(new ConfigStore().project(project.id).trusted, true);
  assert.equal(JSON.parse(readFileSync(join(home, "config.json"), "utf8")).projects.find((p: { id: string }) => p.id === project.id).trusted, true);

  assert.equal(store.setProjectTrusted(project.id, false).trusted, undefined);
  assert.equal(new ConfigStore().project(project.id).trusted, undefined);

  const workspace = store.projects.find((p) => p.path === WORKSPACE_DIR)!;
  assert.equal(workspace.trustFixed, true);
  assert.equal(workspace.trusted, true);
  assert.throws(() => store.setProjectTrusted(workspace.id, false), /always trusted/);
  assert.throws(() => store.setProjectTrusted("nope", true), /Unknown project/);
});

test("maxOutputTokens: positive safe integers set, null and invalid values clear, absent key leaves it", () => {
  const store = new ConfigStore();
  store.patchConfig({ maxOutputTokens: 65536 });
  assert.equal(store.config.maxOutputTokens, 65536);
  store.patchConfig({ homeUrl: "https://example.com/" });
  assert.equal(store.config.maxOutputTokens, 65536);
  store.patchConfig({ maxOutputTokens: null });
  assert.equal("maxOutputTokens" in store.config, false);
  for (const bad of [0, -1, 1.5, "abc", 1e21]) {
    store.patchConfig({ maxOutputTokens: 1000 });
    store.patchConfig({ maxOutputTokens: bad as unknown as number });
    assert.equal(store.config.maxOutputTokens, undefined, String(bad));
    assert.equal("maxOutputTokens" in store.config, false, String(bad));
  }
  assert.equal(new ConfigStore().config.maxOutputTokens, undefined);
});

test("config.set lock check rejects locked keys by name, writes nothing, and lets other patches through", () => {
  const store = new ConfigStore();
  store.assertUnlocked({ homeUrl: "https://example.com/" });
  store.policy = { locked: ["approvalMode", "webSearchEnabled"] };
  const before = store.config.approvalMode;
  assert.throws(() => store.assertUnlocked({ approvalMode: "full-access", instructions: "x" }), /approvalMode/);
  assert.throws(() => store.assertUnlocked({ webSearchEnabled: false }), /webSearchEnabled/);
  assert.equal(store.config.approvalMode, before);
  store.assertUnlocked({ homeUrl: "https://example.org/" });
  assert.equal(store.patchConfig({ homeUrl: "https://example.org/" }).homeUrl, "https://example.org/");
});

const managed = (locked: object, defaults: object = {}) => ({ policy: { version: 1 as const, locked, defaults }, source: "/p.json", warnings: [] });

test("locked policy values overlay the config, are listed in policy.locked, and never reach config.json", () => {
  const store = new ConfigStore(managed({ approvalMode: "read-only", webSearchEnabled: false }));
  assert.deepEqual([...store.policy.locked].sort(), ["approvalMode", "webSearchEnabled"]);
  assert.equal(store.policySource, "/p.json");
  assert.equal(store.config.approvalMode, "read-only");
  assert.equal(store.config.webSearchEnabled, false);
  assert.throws(() => store.assertUnlocked({ approvalMode: "full-access" }), /approvalMode/);
  // An internal patch may persist, but the effective config still shows the locked value.
  assert.equal(store.patchConfig({ approvalMode: "full-access", homeUrl: "https://example.net/" }).approvalMode, "read-only");
  assert.equal(store.config.homeUrl, "https://example.net/");
  const onDisk = JSON.parse(readFileSync(join(home, "config.json"), "utf8")).config;
  assert.notEqual(onDisk.approvalMode, "read-only");
  assert.equal(onDisk.webSearchEnabled, true);
  // Without the policy the stored values show again.
  assert.equal(new ConfigStore().config.webSearchEnabled, true);
});

test("policy defaults apply to never-changed keys on an existing install, not to user-set keys", () => {
  writeFileSync(join(home, "config.json"), JSON.stringify({ userSet: ["instructions"], config: { instructions: "mine", linkTarget: "builtin", maxOutputTokens: 1000 } }));
  const store = new ConfigStore(managed({}, { instructions: "org", maxOutputTokens: 2048, linkTarget: "external" }));
  assert.equal(store.config.instructions, "mine");
  assert.equal(store.config.maxOutputTokens, 2048);
  assert.equal(store.config.linkTarget, "external");
  const onDisk = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  assert.equal(onDisk.config.maxOutputTokens, 2048);
  assert.equal(onDisk.config.linkTarget, "external");
  assert.equal(onDisk.config.instructions, "mine");
  // A later policy change reaches the host again, until the user changes the key.
  assert.equal(new ConfigStore(managed({}, { linkTarget: "home" })).config.linkTarget, "home");
  new ConfigStore().patchConfig({ linkTarget: "builtin" }, { userSet: true });
  assert.equal(new ConfigStore(managed({}, { linkTarget: "home" })).config.linkTarget, "builtin");
});

test("a config.json without userSet is migrated: keys differing from the built-in default count as user-set", () => {
  writeFileSync(join(home, "config.json"), JSON.stringify({ config: { instructions: "mine", linkTarget: "builtin", memoryEnabled: false } }));
  const store = new ConfigStore(managed({}, { instructions: "org", linkTarget: "external", memoryEnabled: true }));
  assert.equal(store.config.instructions, "mine");
  assert.equal(store.config.memoryEnabled, false);
  assert.equal(store.config.linkTarget, "external");
  assert.deepEqual(JSON.parse(readFileSync(join(home, "config.json"), "utf8")).userSet.sort(), ["instructions", "memoryEnabled"]);
});

test("user patches mark keys as user-set; a plain internal patch does not", () => {
  writeFileSync(join(home, "config.json"), JSON.stringify({ userSet: [], config: {} }));
  const store = new ConfigStore();
  store.patchConfig({ memoryEnabled: false });
  assert.deepEqual(JSON.parse(readFileSync(join(home, "config.json"), "utf8")).userSet, []);
  store.patchConfig({ homeUrl: "https://example.com/", linkTarget: "home" }, { userSet: true });
  assert.deepEqual(JSON.parse(readFileSync(join(home, "config.json"), "utf8")).userSet, ["homeUrl", "linkTarget"]);
  assert.deepEqual(new ConfigStore().config.homeUrl, "https://example.com/");
});

test("model switch is refused before any work when defaultModel is locked", async () => {
  const { manager, store } = await makeManager();
  store.policy = { locked: ["defaultModel"] };
  await assert.rejects(manager.setModel("no-such-thread", { provider: "p", id: "m" }), /defaultModel/);
  assert.equal(store.config.defaultModel, undefined);
});

test("a default for a locked key is ignored with a warning", () => {
  const store = new ConfigStore(managed({ approvalMode: "read-only" }, { approvalMode: "full-access", linkTarget: "home" }));
  assert.equal(store.config.approvalMode, "read-only");
  assert.equal(store.config.linkTarget, "home");
  assert.ok(store.policyWarnings.some((w) => w.includes("defaults.approvalMode")));
});
