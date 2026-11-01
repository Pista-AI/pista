import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { setupHome } from "../test-helpers.ts";

// examples/harness-demo is documented in docs/harness.md; this keeps it loadable through the real package path.
const { agentDir, projectDir } = setupHome("harness-example");
const { loadPackageHarness, resetHarnessPackageCache } = await import("./packages.ts");
const { clearRegisteredHarnesses, resolveHarness } = await import("./registry.ts");

const example = join(dirname(fileURLToPath(import.meta.url)), "../../../../examples/harness-demo");
const { version } = JSON.parse(readFileSync(join(example, "package.json"), "utf8")) as { version: string };

test("the harness-demo example loads as a Pi package and registers its tool", async (t) => {
  t.after(() => {
    clearRegisteredHarnesses();
    resetHarnessPackageCache();
  });
  cpSync(example, join(agentDir, "npm", "node_modules", "harness-demo"), { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [`npm:harness-demo@${version}`] }));
  resetHarnessPackageCache();

  const loaded = await loadPackageHarness("demo", { cwd: projectDir, agentDir, projectTrusted: false, managedPackages: [], policy: undefined, selectedByPolicy: false });
  assert.equal(loaded?.id, "demo");
  assert.equal(resolveHarness("demo"), loaded);

  const host = {
    cwd: projectDir,
    runAgent: async () => {
      throw new Error("not called");
    },
    config: () => undefined,
    windowCap: () => undefined,
    readOnlyTools: ["read"],
    state: { read: () => undefined },
  };
  const prompt = loaded!.prompt!(host as never);
  assert.ok(typeof prompt === "string" && prompt.length > 0);

  const tools: string[] = [];
  const pi = new Proxy({ registerTool: (tool: { name: string }) => void tools.push(tool.name) }, { get: (target, key) => (key in target ? target[key as never] : () => undefined) });
  (loaded!.extension!(host as never) as { factory(pi: never): void }).factory(pi as never);
  assert.deepEqual(tools, ["demo_hello"]);
});
