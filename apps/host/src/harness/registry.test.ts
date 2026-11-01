import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveHarness } from "./registry.ts";
import type { HarnessHost } from "./types.ts";

const host: HarnessHost = {
  cwd: "/tmp/none",
  runAgent: async () => {
    throw new Error("not called");
  },
  config: () => undefined,
  windowCap: () => undefined,
  readOnlyTools: ["read"],
  state: { read: () => undefined },
};

const register = (ext: { factory: (pi: never) => unknown }) => {
  const tools: string[] = [];
  const pi = new Proxy({ registerTool: (t: { name: string }) => void tools.push(t.name) }, { get: (target, key) => (key in target ? target[key as never] : () => undefined) });
  ext.factory(pi as never);
  return tools;
};

test("sliced harness registers the slices tool and owns its prompt and entries", () => {
  const sliced = resolveHarness("sliced")!;
  assert.match(sliced.prompt!(host)!, /Sliced mode/);
  assert.deepEqual(sliced.entries, ["pista.slices"]);
  assert.ok(register(sliced.extension!(host) as never).includes("slices"));
});

test("solo harness contributes no prompt, tools or extension", () => {
  const solo = resolveHarness("solo")!;
  assert.equal(solo.prompt?.(host), undefined);
  assert.equal(solo.tools?.(host), undefined);
  assert.equal(solo.extension, undefined);
});

test("an unknown harness id resolves to undefined", () => {
  assert.equal(resolveHarness("nope"), undefined);
});

test("threadTools prefers the harness allowlist, then orchestratorTools, else none", async () => {
  const { threadTools } = await import("./select.ts");
  assert.deepEqual(threadTools({ harness: { id: "x", tools: () => ["read"] }, orchestratorTools: ["a"] }, host), ["read"]);
  assert.deepEqual(threadTools({ harness: { id: "x" }, orchestratorTools: ["a"] }, host), ["a"]);
  assert.equal(threadTools({}, host), undefined);
});
