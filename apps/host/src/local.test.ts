import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  detectLocalServers,
  isLocalProvider,
  listLocalModels,
  LOCAL_CONTEXT,
  maxTokensFor,
  OLLAMA_DEFAULT_CONTEXT,
  parseLmStudioModels,
  pickContextWindow,
  refreshRegistration,
  registerLocalServer,
  thinkingMapFor,
} from "./local.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Routes fetch by "METHOD path" to canned JSON; anything else is a 404. */
function mockFetch(routes: Record<string, unknown>): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = routes[`${init?.method ?? "GET"} ${url.pathname}`];
    return body === undefined ? new Response("nope", { status: 404 }) : new Response(JSON.stringify(body));
  }) as typeof fetch;
}

const gemma = (loadedContext?: number) => ({
  type: "llm",
  key: "google/gemma-4-12b-qat",
  display_name: "Gemma 4 12B QAT",
  max_context_length: 262144,
  loaded_instances: loadedContext ? [{ config: { context_length: loadedContext } }] : [],
  capabilities: { vision: true, trained_for_tool_use: true, reasoning: { allowed_options: ["off", "on"], default: "on" } },
});

test("a loaded LM Studio model advertises the context it actually loaded, not the one requested", () => {
  const [model] = parseLmStudioModels([gemma(22272)]);
  assert.equal(model?.contextWindow, 22272);
  assert.equal(model?.loaded, true);
});

test("an unloaded model is capped at LOCAL_CONTEXT and at its own maximum", () => {
  assert.equal(parseLmStudioModels([gemma()])[0]?.contextWindow, LOCAL_CONTEXT);
  assert.equal(pickContextWindow(undefined, 8192), 8192);
  assert.equal(pickContextWindow(undefined, undefined), LOCAL_CONTEXT);
});

test("embedding models are left out of the LM Studio listing", () => {
  const listed = parseLmStudioModels([gemma(4096), { type: "embedding", key: "nomic", loaded_instances: [] }]);
  assert.deepEqual(listed.map((m) => m.id), ["google/gemma-4-12b-qat"]);
});

test("maxTokens is at most a quarter of the window and at most 8192", () => {
  assert.equal(maxTokensFor(22272), 5568);
  assert.equal(maxTokensFor(32768), 8192);
  assert.equal(maxTokensFor(262144), 8192);
  assert.equal(maxTokensFor(4096), 1024);
});

test("on/off reasoning exposes only off and medium, and never produces \"on\"", () => {
  const map = thinkingMapFor(["off", "on"]);
  assert.deepEqual(map, {
    off: "none",
    minimal: null,
    low: null,
    medium: "medium",
    high: null,
    xhigh: null,
    max: null,
  });
  // LM Studio answers reasoning_effort "on" with a 400.
  assert.ok(!Object.values(map).includes("on"));
  assert.ok(!Object.values(thinkingMapFor(["on"])).includes("on"));
});

test("graded reasoning maps the reported levels directly and hides the rest", () => {
  assert.deepEqual(thinkingMapFor(["low", "medium", "high"]), {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  });
  assert.equal(thinkingMapFor(["off", "low", "high"]).off, "none");
  assert.equal(thinkingMapFor(["off", "low", "high"]).medium, null);
});

test("listLocalModels reads LM Studio's v1 listing without exposing the reasoning options", async () => {
  mockFetch({ "GET /api/v1/models": { models: [gemma(22272)] } });
  const [model] = await listLocalModels("lmstudio", "http://127.0.0.1:1234");
  assert.equal(model?.contextWindow, 22272);
  assert.equal(model?.reasoning, true);
  assert.equal("reasoningOptions" in (model ?? {}), false);
});

test("Ollama windows come from /api/ps for loaded models and /api/show otherwise", async () => {
  mockFetch({
    "GET /v1/models": { data: [{ id: "llama3:latest" }, { id: "qwen3:8b" }, { id: "mystery:1b" }] },
    "GET /api/ps": { models: [{ name: "llama3:latest", model: "llama3:latest", context_length: 16384 }] },
    "POST /api/show": { model_info: { "qwen3.context_length": 40960 } },
  });
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (msg: string) => void warnings.push(msg);
  try {
    const models = await listLocalModels("ollama", "http://127.0.0.1:11434");
    // /api/show answers every model here, so the loaded one must still prefer /api/ps.
    assert.equal(models.find((m) => m.id === "llama3:latest")?.contextWindow, 16384);
    assert.equal(models.find((m) => m.id === "llama3:latest")?.loaded, true);
    assert.equal(models.find((m) => m.id === "qwen3:8b")?.contextWindow, OLLAMA_DEFAULT_CONTEXT);
    assert.equal(warnings.length, 0);
  } finally {
    console.warn = warn;
  }
});

test("Ollama falls back to its default window and warns when the window is unknown", async () => {
  mockFetch({ "GET /v1/models": { data: [{ id: "unknown-model:1b" }] } });
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (msg: string) => void warnings.push(msg);
  try {
    const [model] = await listLocalModels("ollama", "http://127.0.0.1:11434");
    assert.equal(model?.contextWindow, OLLAMA_DEFAULT_CONTEXT);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /unknown-model:1b.*4096/);
  } finally {
    console.warn = warn;
  }
});

test("a failed or empty re-list after a load keeps the registered models", async () => {
  const registered: { models?: { contextWindow: number }[] }[] = [];
  const runtime = { registerProvider: (_id: string, cfg: { models?: { contextWindow: number }[] }) => void registered.push(cfg) } as unknown as ModelRuntime;
  const server = { id: "lmstudio", kind: "lmstudio", name: "LM Studio", baseUrl: "http://127.0.0.1:1234" } as const;

  mockFetch({ "GET /api/v1/models": { models: [gemma()] } });
  await registerLocalServer(runtime, server);
  assert.equal(registered.length, 1);

  mockFetch({}); // every request 404s: the listing fails
  await refreshRegistration(server);
  mockFetch({ "GET /api/v1/models": { models: [] } }); // and an empty listing
  await refreshRegistration(server);
  assert.equal(registered.length, 1);

  mockFetch({ "GET /api/v1/models": { models: [gemma(22272)] } });
  await refreshRegistration(server);
  assert.equal(registered.length, 2);
  assert.equal(registered[1]?.models?.[0]?.contextWindow, 22272);
});

test("isLocalProvider: added servers, loopback URLs and the built-in runtime (even on another host) are local", () => {
  const config = { localServers: [{ id: "lmstudio", kind: "lmstudio" as const, name: "LM Studio", baseUrl: "http://10.0.0.5:1234" }] };
  assert.equal(isLocalProvider("lmstudio", "http://10.0.0.5:1234/v1", config), true);
  assert.equal(isLocalProvider("x", "http://127.0.0.1:9/v1", config), true);
  assert.equal(isLocalProvider("llama.cpp", "http://10.0.0.9:8080/v1", config), true);
  assert.equal(isLocalProvider("openai", "https://api.openai.com/v1", config), false);
});

test("detectLocalServers leaves out the server the built-in runtime already serves", async () => {
  mockFetch({});
  const all = await detectLocalServers([]);
  assert.ok(all.some((s) => s.kind === "llamacpp"));
  const rest = await detectLocalServers([], () => "http://127.0.0.1:8080/");
  assert.ok(!rest.some((s) => s.kind === "llamacpp"));
  assert.equal(rest.length, all.length - 1);
  for (const url of ["http://localhost:8080", "http://[::1]:8080/v1"]) {
    assert.ok(!(await detectLocalServers([], () => url)).some((s) => s.kind === "llamacpp"), url);
  }
});
