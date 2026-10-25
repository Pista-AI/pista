import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxModels, setupHome } from "./test-helpers.ts";

const { root, agentDir } = setupHome("session-default-model", { cleanup: "exit" });
const { ModelRuntime, SessionManager } = await import("@earendil-works/pi-coding-agent");
const { buildSession } = await import("./session.ts");

const savedSettings = () => JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")) as { defaultProvider?: string; defaultModel?: string };

async function build(usePistaDefault: boolean) {
  const runtime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false });
  const { models, ref } = await fauxModels(runtime);
  const session = await buildSession({
    cwd: root,
    models,
    model: undefined,
    ...(usePistaDefault ? { defaultModel: ref } : {}),
    sessionManager: SessionManager.inMemory(root),
    appendSystemPrompt: [],
    extensionFactories: [],
  });
  return { session, ref };
}

test("Pista's default model overwrites a stale default in Pi's settings.json", async () => {
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "stale-provider", defaultModel: "stale-model" }));
  const { session, ref } = await build(true);
  assert.equal(session.settingsManager.getDefaultProvider(), ref.provider);
  assert.equal(session.settingsManager.getDefaultModel(), ref.id);
  assert.equal(savedSettings().defaultProvider, ref.provider);
  assert.equal(savedSettings().defaultModel, ref.id);
});

test("without a Pista default, Pi's settings.json is left alone", async () => {
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "stale-provider", defaultModel: "stale-model" }));
  await build(false);
  assert.equal(savedSettings().defaultProvider, "stale-provider");
  assert.equal(savedSettings().defaultModel, "stale-model");
});
