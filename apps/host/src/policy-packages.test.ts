import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ManagedPolicy } from "@pista/protocol";
import { loadManagedPolicy } from "./policy.ts";
import { fauxModels, setupHome } from "./test-helpers.ts";

const FILE = "/p/policy.json";
const load = (extensions: unknown) => loadManagedPolicy({ PISTA_POLICY_FILE: FILE }, "linux", { exists: () => true, read: () => JSON.stringify({ version: 1, extensions }) });

// -- validation ----------------------------------------------------------------------------------

test("extensions: pinned npm, git and local sources are kept; local paths warn", () => {
  const packages = ["npm:@acme/tools@1.2.3", "npm:plain@0.0.1-beta.2", "git:github.com/acme/pi-tools#v1", "git:github.com/acme/pi-tools@v1", "https://github.com/acme/x@abc123", "git:git@github.com:acme/x@v2", "/opt/pi/shared"];
  const { policy, warnings } = load({ packages, allowUserPackages: false });
  assert.deepEqual(policy?.extensions, { packages, allowUserPackages: false });
  assert.deepEqual(warnings, ['extensions.packages: "/opt/pi/shared" is a local path, it must exist on every machine']);
});

test("extensions: unpinned npm and git sources, blanks, duplicates and non-strings are dropped with a warning", () => {
  const { policy, warnings } = load({ packages: ["npm:@acme/tools", "npm:tools@^1.2.0", "npm:tools@latest", "git:github.com/acme/x", "git:git@github.com:acme/x", "https://github.com/acme/x#", "ssh://git@host/acme/x", "  ", 7, "npm:ok@1.0.0", "npm:ok@1.0.0"] });
  assert.deepEqual(policy?.extensions?.packages, ["npm:ok@1.0.0"]);
  assert.equal(warnings.filter((w) => w.endsWith("package ignored")).length, 7);
  assert.equal(warnings.filter((w) => w.includes("non-empty string")).length, 2);
  assert.ok(warnings.some((w) => w.includes("duplicate")));
});

test("extensions: bad shapes warn instead of throwing", () => {
  assert.equal(load("nope").policy?.extensions, undefined);
  const { policy, warnings } = load({ packages: "npm:x@1.0.0", allowUserPackages: "no", other: 1 });
  assert.deepEqual(policy?.extensions, { packages: [] });
  assert.equal(warnings.length, 3);
});

test("extensions: no section leaves the policy without one", () => {
  assert.equal(loadManagedPolicy({ PISTA_POLICY_FILE: FILE }, "linux", { exists: () => true, read: () => '{"version":1}' }).policy?.extensions, undefined);
});

// -- sync ----------------------------------------------------------------------------------------

const { root, home, agentDir } = setupHome("policy-packages", { cleanup: "exit" });
const { ModelRuntime, SettingsManager } = await import("@earendil-works/pi-coding-agent");
const { buildSession, syncManagedPackages } = await import("./session.ts");
const { ConfigStore } = await import("./config.ts");
const { extensionsSummary } = await import("./policy.ts");

// Local directories keep the test off the network: Pi would install npm and git sources on load.
const pkg = (name: string) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const [corp, corp2, mine] = [pkg("corp"), pkg("corp2"), pkg("mine")];
const settingsFile = join(agentDir, "settings.json");
const packagesOnDisk = () => JSON.parse(readFileSync(settingsFile, "utf8")).packages;
const policyOf = (extensions: ManagedPolicy["extensions"]) => ({ policy: { version: 1, extensions } as ManagedPolicy, source: "t", warnings: [] as string[] });

async function build(store: InstanceType<typeof ConfigStore>, extra: { isLocal?: (m: { provider: string }) => boolean; contextWindow?: number } = {}) {
  const runtime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false });
  const { models, ref } = await fauxModels(runtime, extra.contextWindow ? { contextWindow: extra.contextWindow } : {});
  const session = await buildSession({ cwd: root, models, model: ref, appendSystemPrompt: [], extensionFactories: [], packages: store.packageSync(), ...(extra.isLocal ? { isLocal: extra.isLocal } : {}) });
  const model = models.getModel(ref.provider, ref.id)!;
  const reserve = session.settingsManager.getCompactionReserveTokens(model);
  session.dispose();
  return { reserve };
}
const config = () => JSON.parse(readFileSync(join(home, "config.json"), "utf8"));

test("buildSession adds managed packages and records them", async () => {
  writeFileSync(settingsFile, JSON.stringify({ theme: "keep" }));
  await build(new ConfigStore(policyOf({ packages: [corp] })));
  assert.deepEqual(packagesOnDisk(), [corp]);
  assert.equal(JSON.parse(readFileSync(settingsFile, "utf8")).theme, "keep");
  assert.deepEqual(config().managedPackages, [corp]);
});

test("user packages are kept when allowed and dropped when not", async () => {
  writeFileSync(settingsFile, JSON.stringify({ packages: [mine, { source: corp, skills: [] }] }));
  await build(new ConfigStore(policyOf({ packages: [corp, corp2] })));
  assert.deepEqual(packagesOnDisk(), [mine, { source: corp, skills: [] }, corp2], "user entries and a user's filter on a managed source stay");

  await build(new ConfigStore(policyOf({ packages: [corp, corp2], allowUserPackages: false })));
  assert.deepEqual(packagesOnDisk(), [corp, corp2], "user package and filtered form are replaced by the managed list");
});

test("a package removed from the policy is removed, user packages stay", async () => {
  writeFileSync(settingsFile, JSON.stringify({ packages: [mine] }));
  await build(new ConfigStore(policyOf({ packages: [corp, corp2] })));
  assert.deepEqual(packagesOnDisk(), [mine, corp, corp2]);
  await build(new ConfigStore(policyOf({ packages: [corp2] })));
  assert.deepEqual(packagesOnDisk(), [mine, corp2]);
  assert.deepEqual(config().managedPackages, [corp2]);
  await build(new ConfigStore());
  assert.deepEqual(packagesOnDisk(), [mine], "no section at all removes what the policy installed");
  assert.deepEqual(config().managedPackages, []);
});

test("an unchanged settings file is not rewritten, and no section touches nothing", async () => {
  writeFileSync(settingsFile, JSON.stringify({ packages: [corp] }));
  const store = new ConfigStore(policyOf({ packages: [corp] }));
  await build(store);
  const before = statSync(settingsFile).mtimeMs;
  await new Promise((r) => setTimeout(r, 20));
  await build(new ConfigStore(policyOf({ packages: [corp] })));
  assert.equal(statSync(settingsFile).mtimeMs, before);

  writeFileSync(settingsFile, JSON.stringify({ packages: [mine] }));
  const bytes = readFileSync(settingsFile, "utf8");
  await build(new ConfigStore());
  assert.equal(readFileSync(settingsFile, "utf8"), bytes);
});

test("syncManagedPackages reports what it removed", () => {
  writeFileSync(settingsFile, JSON.stringify({ packages: [mine, corp] }));
  const settings = SettingsManager.create(root, agentDir);
  const result = syncManagedPackages(settings, { packages: [corp], allowUserPackages: false }, []);
  assert.deepEqual(result, { managed: [corp], packages: [corp], changed: true, notes: [`removed user packages: ${mine}`] });
});

test("ConfigStore exposes the section in the hello policy; the startup line counts packages", () => {
  const store = new ConfigStore(policyOf({ packages: [corp], allowUserPackages: false }));
  assert.deepEqual(store.policy.extensions, { managedPackages: [corp], allowUserPackages: false });
  assert.equal(extensionsSummary(store.managedPolicy), ", 1 package, user packages disabled");
  assert.equal(extensionsSummary({ version: 1, extensions: {} }), ", 0 packages");
  assert.equal(extensionsSummary({ version: 1 }), "");
  assert.equal(new ConfigStore().policy.extensions, undefined);
});

test("a managed package's extension loads in the session that synced it", async () => {
  const dir = pkg("loadable");
  mkdirSync(join(dir, "extensions"), { recursive: true });
  writeFileSync(join(dir, "extensions", "marker.js"), "export default () => { globalThis.__managedPackageLoaded = true; };\n");
  const flag = globalThis as { __managedPackageLoaded?: boolean };
  delete flag.__managedPackageLoaded;
  writeFileSync(settingsFile, JSON.stringify({}));
  await build(new ConfigStore(policyOf({ packages: [dir] })));
  assert.equal(flag.__managedPackageLoaded, true);
});

test("buildSession keeps local-model compaction overrides when it syncs packages", async () => {
  writeFileSync(settingsFile, JSON.stringify({}));
  const withOverride = await build(new ConfigStore(policyOf({ packages: [corp] })), { isLocal: () => true, contextWindow: 18000 });
  assert.ok(withOverride.reserve < 16384, `reserve ${withOverride.reserve}`);
  const unchanged = await build(new ConfigStore(policyOf({ packages: [corp] })), { isLocal: () => true, contextWindow: 18000 });
  assert.ok(unchanged.reserve < 16384, "also when nothing needed saving");
});

test("a failed settings write fails the build and does not record the managed list", async () => {
  writeFileSync(settingsFile, JSON.stringify({ packages: [mine] }));
  writeFileSync(join(home, "config.json"), JSON.stringify({ managedPackages: [] }));
  chmodSync(settingsFile, 0o444);
  try {
    if (process.getuid?.() === 0) return; // root ignores file modes
    await assert.rejects(() => build(new ConfigStore(policyOf({ packages: [corp] }))), /managed policy: could not write packages/);
    assert.deepEqual(config().managedPackages, []);
  } finally {
    chmodSync(settingsFile, 0o644);
  }
});
