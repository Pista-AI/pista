import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setupHome } from "../test-helpers.ts";

const { agentDir, projectDir } = setupHome("harness-pkg");
const { loadPackageHarness, resetHarnessPackageCache } = await import("./packages.ts");
const { harnessSource, resolveHarness } = await import("./registry.ts");

const install = (name: string, pkg: object, files: Record<string, string>) => {
  const dir = join(agentDir, "npm", "node_modules", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, ...pkg }));
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), body);
  }
};
const settings = (packages: string[]) => writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages }));
const opts = (managedPackages: string[] = [], policy?: object) => ({ cwd: projectDir, agentDir, projectTrusted: false, managedPackages, policy: policy as never, selectedByPolicy: false });
const h = (id: string, entry: string) => ({ pista: { harness: { id, entry } } });
const warnings: string[] = [];
console.warn = (...a: unknown[]) => void warnings.push(a.join(" "));

test("loads and registers a harness from an installed package", async () => {
  install("@acme/pi-demo-harness", h("demo", "./dist/harness.mjs"), { "dist/harness.mjs": `export default { id: "demo", prompt: () => "demo prompt", extension: () => ({ name: "demo", setup() {} }) };` });
  settings(["npm:@acme/pi-demo-harness@1.0.0"]);
  const loaded = await loadPackageHarness("demo", opts());
  assert.equal(loaded?.prompt?.({} as never), "demo prompt");
  assert.equal(resolveHarness("demo"), loaded);
  assert.deepEqual(harnessSource("demo"), { package: "npm:@acme/pi-demo-harness@1.0.0", managedPackage: false });
});

test("a managed package is marked managed", async () => {
  install("@acme/pi-managed", h("managed1", "./h.mjs"), { "h.mjs": `export default () => ({ id: "managed1" });` });
  settings([]);
  const loaded = await loadPackageHarness("managed1", opts(["npm:@acme/pi-managed@2.0.0"]));
  assert.equal(loaded?.id, "managed1");
  assert.deepEqual(harnessSource("managed1"), { package: "npm:@acme/pi-managed@2.0.0", managedPackage: true });
});

test("a throwing module or a missing declaration yields undefined and warns once", async () => {
  install("bad-throw", h("nothing", "./h.mjs"), { "h.mjs": `throw new Error("boom");` });
  install("no-decl", {}, {});
  settings(["npm:bad-throw@1.0.0", "npm:no-decl@1.0.0"]);
  resetHarnessPackageCache();
  warnings.length = 0;
  assert.equal(await loadPackageHarness("nothing", opts()), undefined);
  assert.equal(await loadPackageHarness("nothing", opts()), undefined);
  assert.equal(warnings.filter((w) => w.includes("bad-throw") && w.includes("boom")).length, 1);
});

test("a harness path escaping the package is rejected", async () => {
  install("evil", h("evil", "../evil.mjs"), {});
  writeFileSync(join(agentDir, "npm", "node_modules", "evil.mjs"), `export default { id: "evil" };`);
  settings(["npm:evil@1.0.0"]);
  resetHarnessPackageCache();
  assert.equal(await loadPackageHarness("evil", opts()), undefined);
  assert.equal(resolveHarness("evil"), undefined);
});

test("a package cannot take a built-in id", async () => {
  install("shadow", h("sliced", "./h.mjs"), { "h.mjs": `export default { id: "sliced" };` });
  settings(["npm:shadow@1.0.0"]);
  resetHarnessPackageCache();
  assert.equal(await loadPackageHarness("sliced", opts()), undefined);
  assert.equal(harnessSource("sliced"), "builtin");
});

test("a policy-denied package is not imported; a managed one is", async () => {
  const marker = join(agentDir, "imported.txt");
  const body = `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "x"); export default { id: "gated" };`;
  install("gated-pkg", h("gated", "./h.mjs"), { "h.mjs": body });
  settings(["npm:gated-pkg@1.0.0"]);
  const policy = { version: 1, harnesses: { allow: ["gated"] } };
  resetHarnessPackageCache();
  assert.equal(await loadPackageHarness("gated", opts([], policy)), undefined);
  assert.equal(existsSync(marker), false);
  assert.equal(resolveHarness("gated"), undefined);
  resetHarnessPackageCache();
  const loaded = await loadPackageHarness("gated", opts(["npm:gated-pkg@1.0.0"], policy));
  assert.equal(loaded?.id, "gated");
  assert.equal(existsSync(marker), true);
});

test("a policy-denied package emits one audit event with the package source", async () => {
  install("audited-pkg", h("audited", "./h.mjs"), { "h.mjs": `export default { id: "audited" };` });
  settings(["npm:audited-pkg@1.0.0"]);
  const events: Array<{ name: string; attrs: Record<string, unknown> }> = [];
  const audit = { emit: (name: string, attrs: Record<string, unknown>) => void events.push({ name, attrs }), flush: async () => {}, dispose: async () => {}, includePrompts: false, includeToolArgs: false, secrets: [] } as never;
  resetHarnessPackageCache();
  assert.equal(await loadPackageHarness("audited", { ...opts([], { version: 1, harnesses: { allow: ["solo"] } }), audit }), undefined);
  assert.deepEqual(events, [{ name: "pista.harness.decision", attrs: { "harness.id": "audited", decision: "deny", "decision.rule": "harnesses.allow", "decision.source": "policy", "harness.package": "npm:audited-pkg@1.0.0" } }]);
});

test("a package with a different id is never imported", async () => {
  const marker = join(agentDir, "other.txt");
  install("other-pkg", h("other", "./h.mjs"), { "h.mjs": `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "x"); export default { id: "other" };` });
  settings(["npm:other-pkg@1.0.0"]);
  resetHarnessPackageCache();
  assert.equal(await loadPackageHarness("wanted", opts()), undefined);
  assert.equal(existsSync(marker), false);
});

test("a bare-string manifest is rejected", async () => {
  install("bare", { pista: { harness: "./h.mjs" } }, { "h.mjs": `export default { id: "bare" };` });
  settings(["npm:bare@1.0.0"]);
  resetHarnessPackageCache();
  warnings.length = 0;
  assert.equal(await loadPackageHarness("bare", opts()), undefined);
  assert.ok(warnings.some((w) => w.includes("bare") && w.includes("object")));
});

test("a harness with a malformed eval block is rejected with a warning", async () => {
  install("bad-eval", h("badeval", "./h.mjs"), { "h.mjs": `export default { id: "badeval", eval: { metrics: () => undefined, column: { header: 1, cell: () => "" } } };` });
  settings(["npm:bad-eval@1.0.0"]);
  resetHarnessPackageCache();
  warnings.length = 0;
  assert.equal(await loadPackageHarness("badeval", opts()), undefined);
  assert.ok(warnings.some((w) => w.includes("bad-eval") && w.includes("eval")));
  install("good-eval", h("goodeval", "./h.mjs"), { "h.mjs": `export default { id: "goodeval", eval: { metrics: () => ({}), column: { header: "X", cell: () => "" } } };` });
  settings(["npm:good-eval@1.0.0"]);
  resetHarnessPackageCache();
  assert.equal((await loadPackageHarness("goodeval", opts()))?.id, "goodeval");
});
