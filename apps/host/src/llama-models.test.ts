import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import type { HostEvent } from "@pista/protocol";
import { FakeRouter, ROUTER_MODEL_ID as ID } from "./llama-router.fake.ts";
import { CONTEXT_TOO_SMALL_MESSAGE, DEFAULT_CONTEXT, createSseParser, isModelSpec, LlamaModels, MIN_USEFUL_CONTEXT, parseModelsIni, plannedContext, toLlamaModel, type RouterEntry } from "./llama-models.ts";
import { LlamaRuntime } from "./llama-runtime.ts";

const INI = parseModelsIni("version = 1\n; comment\n[*]\nc = 16384\nnp = 1\n\n[other/model:Q4]\nctx-size = 4096\n\n[zero/model:Q4]\nc = 0\n");

describe("spec and ini", () => {
  it("accepts <org>/<repo>:<quant> and rejects anything else", () => {
    assert.equal(isModelSpec(ID), true);
    assert.equal(isModelSpec("unsloth/Qwen3-1.7B-GGUF:Q4_K_M"), true);
    for (const bad of ["", "no-slash:Q8_0", "a/b", "a/b:", "a/b:Q8 0", "a/b:Q8_0\n", '{"x":1}', "../b:Q8", "a/b:Q8_0/extra", "http://a/b:Q8", "a/b:Q8_0 --flag"]) {
      assert.equal(isModelSpec(bad), false, JSON.stringify(bad));
    }
  });

  it("parses sections, ignores comments, and reads the context", () => {
    assert.deepEqual(INI["*"], { c: "16384", np: "1" });
    assert.equal(INI["other/model:Q4"]?.["ctx-size"], "4096");
    const entry = (over: Partial<RouterEntry>): RouterEntry => ({ id: ID, status: { value: "unloaded" }, ...over });
    assert.equal(plannedContext(entry({}), INI), 16384);
    assert.equal(plannedContext(entry({ id: "other/model:Q4" }), INI), 4096);
    assert.equal(DEFAULT_CONTEXT, 32768);
    assert.equal(plannedContext(entry({}), {}), DEFAULT_CONTEXT, "no preset: default (matches the default models.ini)");
    assert.equal(plannedContext(entry({ context_length: 256 }), INI), 256, "never above the trained context");
    assert.equal(plannedContext(entry({ status: { value: "unloaded", args: ["--ctx-size", "8192"] }, context_length: 40960 }), INI), 8192, "child args win");
  });

  it("c = 0 means the trained context, not the default", () => {
    const zero: RouterEntry = { id: "zero/model:Q4", status: { value: "unloaded" }, context_length: 40960 };
    assert.equal(plannedContext(zero, INI), 40960);
    assert.equal(plannedContext({ ...zero, context_length: undefined }, INI), DEFAULT_CONTEXT, "trained value unknown: default");
    assert.equal(plannedContext({ ...zero, id: ID, status: { value: "unloaded", args: ["-c", "0"] } }, INI), 40960);
  });
});

describe("toLlamaModel", () => {
  it("uses the loaded n_ctx for a loaded model and the plan for an unloaded one", () => {
    const loaded = toLlamaModel({ id: ID, status: { value: "loaded" }, context_length: 40960, meta: { n_ctx: 12000, size: 100 } }, INI);
    assert.deepEqual([loaded.loaded, loaded.status, loaded.contextWindow, loaded.trainedContext, loaded.sizeBytes], [true, "loaded", 12000, 40960, 100]);
    const unloaded = toLlamaModel({ id: ID, status: { value: "unloaded" }, context_length: 40960 }, INI);
    assert.deepEqual([unloaded.loaded, unloaded.status, unloaded.contextWindow], [false, "unloaded", 16384]);
    assert.equal(toLlamaModel({ id: ID, status: { value: "sleeping" } }, INI).status, "unloaded");
    assert.equal(toLlamaModel({ id: ID, status: { value: "weird" } }, INI).status, "error");
  });
});

describe("toLlamaModel context warning", () => {
  it("warns below MIN_USEFUL_CONTEXT, stays quiet at 32k, and does not change status", () => {
    assert.equal(MIN_USEFUL_CONTEXT, 24576);
    const small = toLlamaModel({ id: ID, status: { value: "unloaded" }, context_length: 40960 }, INI); // planned 16384
    assert.equal(small.message, CONTEXT_TOO_SMALL_MESSAGE);
    assert.equal(small.status, "unloaded");
    const smallLoaded = toLlamaModel({ id: ID, status: { value: "loaded" }, meta: { n_ctx: 16384 } }, INI);
    assert.equal(smallLoaded.message, CONTEXT_TOO_SMALL_MESSAGE);
    assert.equal(smallLoaded.status, "loaded");
    const big = toLlamaModel({ id: ID, status: { value: "loaded" }, context_length: 40960, meta: { n_ctx: 32768 } }, INI);
    assert.equal(big.message, undefined);
    assert.equal(toLlamaModel({ id: ID, status: { value: "weird" } }, INI).message?.startsWith("The router reports"), true);
  });
});

describe("createSseParser", () => {
  it("handles events split across chunks, CRLF and multi-line data", () => {
    const got: string[] = [];
    const push = createSseParser((d) => got.push(d));
    push('data: {"a"');
    push(":1}\n");
    assert.deepEqual(got, []);
    push("\n: comment\r\ndata: x\r\ndata: y\r\n\r\ndata: z\n\n");
    assert.deepEqual(got, ['{"a":1}', "x\ny", "z"]);
  });

  it("passes the event: name along and forgets it after each event", () => {
    const got: [string, string | undefined][] = [];
    const push = createSseParser((d, name) => got.push([d, name]));
    push("event: download_finished\ndata: {}\n\ndata: {}\n\n");
    assert.deepEqual(got, [["{}", "download_finished"], ["{}", undefined]]);
  });
});

const router = new FakeRouter();
before(() => router.start());
after(() => router.stop());
afterEach(() => router.reset());

function setup(extra: { enabled?: () => boolean; progressIntervalMs?: number; stallTimeoutMs?: number; loadTimeoutMs?: number; unloadTimeoutMs?: number } = {}) {
  const events: HostEvent[] = [];
  const runtime = new LlamaRuntime({ home: router.home, env: { PISTA_LLAMA_RUNTIME: "external", LLAMA_BASE_URL: router.base } });
  const models = new LlamaModels(runtime, { emit: (e) => events.push(e), ...extra });
  return { models, events, runtime };
}
const downloads = (events: HostEvent[]) => events.filter((e): e is Extract<HostEvent, { type: "llama.download" }> => e.type === "llama.download");
const sse = (event: object) => `data: ${JSON.stringify(event)}\n\n`;

describe("LlamaModels against a fake router", () => {
  it("lists with the planned context when unloaded and reasoning once loaded", async () => {
    const { models } = setup();
    const [unloaded] = await models.list();
    assert.equal(unloaded?.status, "unloaded");
    assert.equal(unloaded?.contextWindow, 256, "capped by the trained context");
    assert.equal(unloaded?.reasoning, undefined);
    router.state.status = "loaded";
    const [loaded] = await models.list();
    assert.deepEqual([loaded?.loaded, loaded?.contextWindow, loaded?.sizeBytes, loaded?.reasoning], [true, 256, 38662272, true]);
    await models.list();
    assert.equal(router.requestsTo("/props").length, 1, "the reasoning flag is cached once known");
  });

  it("load waits until the model is loaded and tells the UI", async () => {
    const { models, events } = setup();
    await models.load(ID);
    assert.equal(router.state.status, "loaded");
    assert.deepEqual(JSON.parse(router.requestsTo("/models/load")[0]!.body), { model: ID });
    assert.ok(events.some((e) => e.type === "llama.models"));
  });

  it("a load that ends in an error status rejects with the router's message", async () => {
    const { models } = setup();
    router.state.loadResult = "failed";
    await assert.rejects(models.load(ID), /status "failed"/);
  });

  it("a load that never finishes rejects after the timeout", async () => {
    const { models } = setup({ loadTimeoutMs: 400 });
    router.state.loadResult = "stuck";
    await assert.rejects(models.load(ID), /did not finish loading in time/);
  });

  it("surfaces the router's error message on a failed request", async () => {
    const { models } = setup();
    await assert.rejects(models.load("missing"), /model not found/);
  });

  it("stops waiting at once when the router has died instead of restarting it", async () => {
    let base: string | undefined = router.base;
    const stub = {
      mode: "external",
      get baseUrl() {
        return base;
      },
      paths: { ini: "" },
      touch: async (fn: (b: string) => Promise<unknown>) => fn(router.base),
      keepAlive() {},
    } as unknown as LlamaRuntime;
    const models = new LlamaModels(stub, { emit: () => {}, loadTimeoutMs: 60_000 });
    router.state.loadResult = "stuck";
    const started = Date.now();
    const result = models.load(ID);
    setTimeout(() => (base = undefined), 100);
    await assert.rejects(result, /router stopped/);
    assert.ok(Date.now() - started < 5000);
  });

  it("unload posts the id, and fails if the model stays loaded", async () => {
    const { models } = setup({ unloadTimeoutMs: 400 });
    router.state.status = "loaded";
    await models.unload(ID);
    assert.deepEqual(JSON.parse(router.requestsTo("/models/unload")[0]!.body), { model: ID });
    assert.equal(router.state.status, "unloaded");
    router.state.status = "loaded";
    router.state.stuckUnload = true;
    await assert.rejects(models.unload(ID), /still loaded/);
  });

  it("download validates the spec before sending anything", async () => {
    const { models } = setup();
    await assert.rejects(models.download("bad spec"), /not a model spec/);
    assert.equal(router.state.requests.length, 0);
  });

  it("a fresh download reports bytes 0 and waits for progress; a cached one is done at once", async () => {
    router.state.known = false;
    const fresh = setup();
    await fresh.models.download(ID);
    assert.deepEqual(JSON.parse(router.requestsTo("/models", "POST")[0]!.body), { model: ID });
    assert.deepEqual(downloads(fresh.events).map((d) => [d.bytes, d.done, d.phase]), [[0, undefined, "starting"]]);
    fresh.models.stopWatching();
    router.reset();
    router.state.cached = true;
    const cached = setup();
    await cached.models.download(ID);
    assert.deepEqual(downloads(cached.events).map((d) => d.done), [true]);
  });

  it("a new download that the router lists as idle right after the POST is not reported as done", async () => {
    router.state.known = false;
    router.state.statusAfterPost = "unloaded";
    const { models, events } = setup({ stallTimeoutMs: 10_000 });
    await models.download(ID);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(downloads(events).map((d) => [d.done, d.phase]), [[undefined, "starting"]]);
    models.stopWatching();
  });

  it("a stalled download is checked against the router: still downloading keeps waiting, an error ends it", async () => {
    router.state.known = false;
    const { models, events } = setup({ stallTimeoutMs: 150 });
    await models.download(ID);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.deepEqual(downloads(events).map((d) => d.phase), ["starting"], "the router says downloading: no verdict yet");
    router.state.status = "failed";
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.deepEqual(downloads(events).map((d) => d.phase), ["starting", "error"]);
    assert.ok(downloads(events)[1]!.error?.startsWith("No progress from the runtime"));
    models.stopWatching();
  });

  it("a stalled download that the router has completed is reported as done", async () => {
    router.state.known = false;
    const { models, events } = setup({ stallTimeoutMs: 150 });
    await models.download(ID);
    router.state.status = "unloaded";
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.deepEqual(downloads(events).map((d) => d.phase), ["starting", "done"]);
    models.stopWatching();
  });

  it("clear() fails downloads in flight and stops their stall timers", async () => {
    router.state.known = false;
    const { models, events } = setup({ stallTimeoutMs: 100 });
    await models.download(ID);
    models.clear();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(downloads(events).map((d) => [d.phase, d.error]), [["starting", undefined], ["error", "The llama.cpp runtime stopped."]]);
  });

  it("prepare loads an unloaded model once and leaves a loaded one alone", async () => {
    const { models } = setup();
    let loading = 0;
    await models.prepare(ID, () => loading++);
    assert.equal(loading, 1);
    assert.equal(router.requestsTo("/models/load").length, 1);
    await models.prepare(ID, () => loading++);
    assert.equal(loading, 1);
    await assert.rejects(models.prepare("nope/model:Q4"), /no model/);
  });

  it("two concurrent prepares send one load request", async () => {
    const { models } = setup();
    router.state.loadDelay = true;
    await Promise.all([models.prepare(ID), models.prepare(ID)]);
    assert.equal(router.requestsTo("/models/load").length, 1);
    assert.equal(router.state.status, "loaded");
  });

  it("a model that is already loading is waited for, not loaded again; a downloading one is refused", async () => {
    const { models } = setup();
    router.state.status = "loading";
    setTimeout(() => (router.state.status = "loaded"), 300);
    await models.load(ID);
    assert.equal(router.requestsTo("/models/load").length, 0);
    router.state.status = "downloading";
    await assert.rejects(models.prepare(ID), /still downloading/);
  });

  it("a managed runtime that is turned off is not started from here", async () => {
    const runtime = new LlamaRuntime({ home: router.home, env: { PISTA_LLAMA_RUNTIME: "managed" }, platformKey: "test-x64" });
    const models = new LlamaModels(runtime, { emit: () => {}, enabled: () => false });
    await assert.rejects(models.list(), /turned off/);
    await assert.rejects(models.load(ID), /turned off/);
    await assert.rejects(models.download(ID), /turned off/);
    await assert.rejects(models.prepare(ID), /turned off/);
    assert.equal(runtime.status().state, "unsupported", "nothing was installed or started");
  });

  it("keepAlive never starts the runtime", () => {
    const runtime = new LlamaRuntime({ home: router.home, env: { PISTA_LLAMA_RUNTIME: "managed" }, platformKey: "test-x64" });
    runtime.keepAlive();
    assert.equal(runtime.status().state, "unsupported");
  });
});

describe("watchProgress", () => {
  const progress = (done: number) =>
    sse({ model: ID, event: "download_progress", data: { progress: { "https://h/a.gguf": { done, total: 1000 }, "https://h/b.gguf": { done: 0, total: 500 } } } });

  it("parses split SSE chunks, throttles progress, and ends with the last known bytes", async () => {
    const { models, events } = setup({ progressIntervalMs: 1000 });
    const line = progress(100);
    router.state.sse = [
      sse({ model: ID, event: "model_status", data: { status: "downloading" } }),
      line.slice(0, 30),
      line.slice(30),
      progress(200), // inside the throttle window: not emitted, but remembered for the final event
      sse({ model: ID, event: "download_finished" }),
    ];
    await models.watchProgress(new AbortController().signal);
    assert.deepEqual(downloads(events).map((d) => [d.bytes, d.total, d.done]), [[100, 1500, undefined], [200, 1500, true]]);
  });

  it("reports an error for a download in progress", async () => {
    const { models, events } = setup();
    router.state.sse = [sse({ model: ID, event: "model_status", data: { status: "downloading" } }), sse({ model: ID, event: "download_failed", data: { error: "disk full" } })];
    await models.watchProgress(new AbortController().signal);
    assert.deepEqual(downloads(events).map((d) => d.error), ["disk full"]);
  });

  it("a failed load does not look like a failed download", async () => {
    const { models, events } = setup();
    router.state.sse = [sse({ model: ID, event: "status_change", data: { status: "error", error: "out of memory" } }), sse({ model: ID, event: "load_failed" })];
    await models.watchProgress(new AbortController().signal);
    assert.deepEqual(downloads(events), []);
  });

  it("models_reload for \"*\" refreshes the list", async () => {
    const { models } = setup();
    router.state.sse = [sse({ model: "*", event: "models_reload" })];
    await models.watchProgress(new AbortController().signal);
    const listed = () => router.requestsTo("/models", "GET").length;
    const after = listed();
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.ok(listed() > after, "a scheduled refresh listed again");
  });

  it("takes the event name from an event: line when the JSON has none", async () => {
    const { models, events } = setup();
    router.state.sse = [
      sse({ model: ID, event: "download_progress", data: { progress: { "https://h/a.gguf": { done: 5, total: 10 } } } }),
      `event: download_finished\ndata: ${JSON.stringify({ model: ID })}\n\n`,
    ];
    await models.watchProgress(new AbortController().signal);
    assert.deepEqual(downloads(events).map((d) => [d.bytes, d.done]), [[5, undefined], [5, true]]);
  });

  it("every (re)connect re-emits where the downloads in flight stand", async () => {
    router.state.status = "downloading";
    const { models, events } = setup({ stallTimeoutMs: 10_000 });
    router.state.sse = [sse({ model: ID, event: "download_progress", data: { progress: { "https://h/a.gguf": { done: 100, total: 1000 } } } })];
    await models.watchProgress(new AbortController().signal);
    const first = downloads(events).length;
    router.state.sse = [];
    await models.watchProgress(new AbortController().signal);
    assert.deepEqual(downloads(events).slice(first).map((d) => [d.bytes, d.total, d.phase]), [[100, 1000, "downloading"]]);
    router.state.status = "unloaded"; // finished while the stream was down
    await models.watchProgress(new AbortController().signal);
    assert.deepEqual(downloads(events).slice(first + 1).map((d) => [d.bytes, d.done]), [[100, true]]);
    models.stopWatching();
  });
});
