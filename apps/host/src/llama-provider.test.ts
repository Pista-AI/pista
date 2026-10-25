import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { HostEvent, LlamaModel } from "@pista/protocol";
import { FakeRouter, ROUTER_MODEL_ID as ID } from "./llama-router.fake.ts";
import { LlamaModels } from "./llama-models.ts";
import { LLAMA_PROVIDER, LlamaProvider, toPiModel } from "./llama-provider.ts";
import { LlamaRuntime } from "./llama-runtime.ts";

describe("toPiModel", () => {
  const base: LlamaModel = { id: ID, name: ID, loaded: false, status: "unloaded", contextWindow: 16384 };
  it("advertises the model's window, a built-in suffix and no reasoning unless known", () => {
    const m = toPiModel(base);
    assert.equal(m.name, `${ID} (built-in)`);
    assert.equal(m.contextWindow, 16384);
    assert.equal(m.maxTokens, 4096);
    assert.equal(m.reasoning, false);
    assert.equal(toPiModel({ ...base, loaded: true, status: "loaded", contextWindow: 256 }).contextWindow, 256);
  });
  it("maps thinking off to reasoning_effort none and on to medium", () => {
    const m = toPiModel({ ...base, reasoning: true }) as { reasoning: boolean; thinkingLevelMap: Record<string, string | null>; compat: { supportsReasoningEffort: boolean } };
    assert.equal(m.reasoning, true);
    assert.equal(m.thinkingLevelMap.off, "none");
    assert.equal(m.thinkingLevelMap.medium, "medium");
    assert.equal(m.thinkingLevelMap.high, null);
    assert.equal(m.compat.supportsReasoningEffort, true);
  });
});

const router = new FakeRouter();
before(() => router.start());
after(() => router.stop());
afterEach(() => router.reset());

function fakePi() {
  type Config = { baseUrl: string; models: ReturnType<typeof toPiModel>[]; apiKey: string; refreshModels: () => Promise<ReturnType<typeof toPiModel>[]> };
  const calls: { registered: { id: string; config: Config }[]; unregistered: string[] } = { registered: [], unregistered: [] };
  const pi = {
    registerProvider: (id: string, config: Config) => calls.registered.push({ id, config }),
    unregisterProvider: (id: string) => calls.unregistered.push(id),
  } as unknown as ModelRuntime;
  return { pi, calls };
}

function setup(onChange?: (m: LlamaModel[]) => void) {
  const events: HostEvent[] = [];
  const runtime = new LlamaRuntime({ home: router.home, env: { PISTA_LLAMA_RUNTIME: "external", LLAMA_BASE_URL: router.base } });
  const models = new LlamaModels(runtime, { emit: (e) => events.push(e), onChange });
  return { models, events };
}

const listed: LlamaModel[] = [
  { id: "a/loaded:Q4", name: "a/loaded:Q4", loaded: true, status: "loaded", contextWindow: 8192 },
  { id: "a/idle:Q4", name: "a/idle:Q4", loaded: false, status: "unloaded", contextWindow: 16384 },
  { id: "a/busy:Q4", name: "a/busy:Q4", loaded: false, status: "downloading" },
];

describe("LlamaProvider", () => {
  it("registers one Pi model per ready router model against baseUrl/v1", async () => {
    const { pi, calls } = fakePi();
    const provider = new LlamaProvider(pi, () => "http://127.0.0.1:9", setup().models);
    provider.register(listed);
    const [call] = calls.registered;
    assert.equal(call?.id, LLAMA_PROVIDER);
    assert.equal(call?.config.baseUrl, "http://127.0.0.1:9/v1");
    assert.equal(call?.config.apiKey, "local");
    assert.deepEqual(call?.config.models.map((m) => [m.id, m.contextWindow]), [["a/loaded:Q4", 8192], ["a/idle:Q4", 16384]]);
  });

  it("refreshModels also leaves out models that are still downloading", async () => {
    const { pi, calls } = fakePi();
    const { models } = setup();
    router.state.status = "downloading";
    const provider = new LlamaProvider(pi, () => router.base, models);
    provider.register(listed);
    assert.deepEqual(await calls.registered[0]!.config.refreshModels(), []);
    router.state.status = "unloaded";
    assert.deepEqual((await calls.registered[0]!.config.refreshModels()).map((m) => m.id), [ID]);
  });

  it("registers on running, unregisters and clears when the router stops, and ignores repeats", async () => {
    const { pi, calls } = fakePi();
    const state = { url: router.base as string | undefined };
    const { models, events } = setup((list) => provider.register(list));
    const provider = new LlamaProvider(pi, () => state.url, models);
    const status = (s: "running" | "installed") => ({ state: s, mode: "managed" as const });
    provider.onStatus(status("running"));
    await new Promise((resolve) => setTimeout(resolve, 150)); // the sync and the event watcher run in the background
    assert.equal(calls.registered.at(-1)?.config.models[0]?.id, ID);
    state.url = undefined;
    provider.onStatus(status("installed"));
    assert.deepEqual(calls.unregistered, [LLAMA_PROVIDER]);
    assert.deepEqual((events.at(-1) as { models?: unknown[] }).models, []);
    provider.onStatus(status("installed"));
    assert.equal(calls.unregistered.length, 1);
    models.stopWatching();
  });
});

describe("router events refresh the provider", () => {
  it("a status event from the router re-lists and calls onChange", async () => {
    const changes: LlamaModel[][] = [];
    const { models } = setup((list) => changes.push(list));
    router.state.status = "loaded";
    router.state.sse = [`data: ${JSON.stringify({ model: ID, event: "model_status", data: { status: "loaded" } })}\n\n`];
    models.startWatching();
    await new Promise((resolve) => setTimeout(resolve, 500));
    models.stopWatching();
    assert.equal(changes.at(-1)?.[0]?.status, "loaded");
  });

  it("load tells onChange so the provider sees the loaded window", async () => {
    const changes: LlamaModel[][] = [];
    const { models } = setup((list) => changes.push(list));
    await models.load(ID);
    assert.equal(changes.at(-1)?.[0]?.loaded, true);
  });
});
