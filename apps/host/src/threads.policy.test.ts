import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { fauxModels, liveOf, makeManager, setupHome } from "./test-helpers.ts";

const { projectDir } = setupHome("policy-access");
const { models, ref } = await fauxModels();
await models.setRuntimeApiKey(ref.provider, "test-key");
const other = { provider: ref.provider, id: "not-listed" };
type Live = { session: { model?: { provider: string; id: string }; sessionManager: { appendMessage(m: unknown): void }; setModel(m: unknown): Promise<void> } };
const outside = { provider: "anthropic", id: "claude-x" };

test("thread.setModel rejects a model outside models.allow before doing anything", async () => {
  const { manager, project } = await makeManager({ projectDir, models, policy: { version: 1, models: { allow: [`${ref.provider}/${ref.id}`] } } });
  const { summary } = await manager.create(project.id);
  await assert.rejects(manager.setModel(summary.id, other), /Not allowed by your organisation's policy: .*not-listed/);
  await manager.setModel(summary.id, ref);
});

test("a disallowed default model falls back to the first allowed model at load", async () => {
  const { manager, store, project } = await makeManager({ projectDir, models, policy: { version: 1, providers: { allow: [ref.provider] } } });
  store.patchConfig({ defaultModel: outside });
  const { summary } = await manager.create(project.id);
  assert.equal(liveOf<Live>(manager).get(summary.id)?.session.model?.provider, ref.provider);
});

test("an allowed default model is kept", async () => {
  const { manager, store, project } = await makeManager({ projectDir, models, policy: { version: 1, models: { allow: [`${ref.provider}/*`] } } });
  store.patchConfig({ defaultModel: ref });
  const { summary } = await manager.create(project.id);
  const model = liveOf<Live>(manager).get(summary.id)?.session.model;
  assert.deepEqual({ provider: model?.provider, id: model?.id }, ref);
});

test("when no available model is allowed, a session cannot start", async () => {
  const { manager, project } = await makeManager({ projectDir, models, policy: { version: 1, providers: { allow: ["nobody"] } } });
  await assert.rejects(manager.create(project.id), /Not allowed by your organisation's policy/);
});

/** A second provider the first thread switches to, so the saved session names a model a later policy can disallow. */
async function threadOnOtherModel() {
  const first = await makeManager({ projectDir, models });
  models.registerProvider("other", {
    name: "Other",
    baseUrl: "http://127.0.0.1:1",
    api: "openai-completions",
    apiKey: "k",
    models: [{ id: "o-1", name: "o-1", api: "openai-completions", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8000, maxTokens: 1000 }],
  });
  const { summary } = await first.manager.create(first.project.id);
  await first.manager.setModel(summary.id, { provider: "other", id: "o-1" });
  const live = liveOf<Live>(first.manager).get(summary.id)!;
  assert.equal(live.session.model?.provider, "other");
  live.session.sessionManager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  return summary.id;
}

test("restored session on a disallowed model moves to an allowed one", async () => {
  const id = await threadOnOtherModel();
  const { manager } = await makeManager({ models, dispose: false, policy: { version: 1, providers: { allow: [ref.provider] } } });
  await manager.list();
  await manager.open(id);
  assert.equal(liveOf<Live>(manager).get(id)?.session.model?.provider, ref.provider);
});

test("restored session fails closed and is disposed when no replacement exists", async () => {
  const id = await threadOnOtherModel();
  // The default model is allowed (so the start check passes) but nothing allowed is available, so only the restored-session check can catch the saved model.
  const { manager, store } = await makeManager({ models, dispose: false, policy: { version: 1, providers: { allow: ["ghost"] } } });
  store.patchConfig({ defaultModel: { provider: "ghost", id: "x" } });
  await manager.list();
  let disposed = 0;
  const original = AgentSession.prototype.dispose;
  AgentSession.prototype.dispose = function (this: AgentSession) {
    disposed++;
    return original.call(this);
  };
  try {
    await assert.rejects(manager.open(id), /Not allowed by your organisation's policy/);
  } finally {
    AgentSession.prototype.dispose = original;
  }
  assert.equal(disposed, 1);
  assert.equal(liveOf<Live>(manager).has(id), false);
});

test("allowed models that are not configured are reported as such, naming the gateway key variable", async () => {
  const policy = {
    version: 1 as const,
    providers: { allow: ["gw"], gateways: [{ id: "gw", name: "GW", kind: "openai-compatible" as const, baseUrl: "https://gw.example.com/v1", apiKeyEnv: "GW_KEY", models: [{ id: "m" }] }] },
  };
  const { registerPolicyGateways } = await import("./policy-providers.ts");
  const { manager, project } = await makeManager({ projectDir, models, policy });
  registerPolicyGateways(policy, {}, (id, config) => models.registerProvider(id, config), []);
  await assert.rejects(manager.create(project.id), /No allowed model is configured; set GW_KEY/);
});
