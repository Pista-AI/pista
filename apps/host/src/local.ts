import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fetchJson } from "@pista/local-runtime";
import type { HostConfig, LocalModel, LocalServer, LocalServerKind, LocalServerStatus } from "@pista/protocol";
import type { ConfigStore } from "./config.ts";
import type { Hub } from "./hub.ts";

/** Pi provider id of the built-in llama.cpp runtime. Distinct from the `llamacpp` id of an added llama.cpp server. Lives here so llama-provider.ts and this file need not import each other. */
export const LLAMA_PROVIDER = "llama.cpp";

/** Default endpoints of common local model servers (all OpenAI-compatible under /v1). */
export const KNOWN_SERVERS: { kind: LocalServerKind; name: string; baseUrl: string }[] = [
  { kind: "lmstudio", name: "LM Studio", baseUrl: "http://127.0.0.1:1234" },
  { kind: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434" },
  { kind: "llamacpp", name: "llama.cpp", baseUrl: "http://127.0.0.1:8080" },
];

/** LM Studio's CLI, installed alongside the app. */
const LMS_CLI = join(homedir(), ".cache", "lm-studio", "bin", "lms");
let lastStartAttempt = 0;

async function reachable(baseUrl: string): Promise<boolean> {
  try {
    await getJson(`${baseUrl}/v1/models`);
    return true;
  } catch {
    return false;
  }
}

/**
 * LM Studio's server stops when the app quits. If it's down and the `lms` CLI is installed,
 * start it (at most once a minute) so local models keep working without manual steps.
 */
export async function ensureServerRunning(server: LocalServer): Promise<boolean> {
  if (await reachable(server.baseUrl)) return true;
  if (server.kind !== "lmstudio" || !existsSync(LMS_CLI) || Date.now() - lastStartAttempt < 60_000) return false;
  lastStartAttempt = Date.now();
  const port = new URL(server.baseUrl).port || "1234";
  await new Promise<void>((resolve) => execFile(LMS_CLI, ["server", "start", "--port", port], { timeout: 60_000 }, () => resolve()));
  return reachable(server.baseUrl);
}

/** Context length local models are loaded with; agents need far more than LM Studio's default. */
export const LOCAL_CONTEXT = 32_768;

const getJson = <T>(url: string): Promise<T> => fetchJson<T>(url, { timeoutMs: 2500 });

/** A listed model plus the reasoning options its server reports (used to build Pi's thinking map). */
export type ListedModel = LocalModel & { reasoningOptions?: string[] };

/** What the server actually loaded wins; an unloaded model is assumed to get LOCAL_CONTEXT, capped by what it supports. */
export function pickContextWindow(loaded: number | undefined, max: number | undefined): number {
  return loaded ?? Math.min(LOCAL_CONTEXT, max ?? LOCAL_CONTEXT);
}

/** Never ask for more output than a quarter of the window, so a small window keeps room for the prompt. */
export function maxTokensFor(contextWindow: number): number {
  return Math.min(8192, Math.floor(contextWindow / 4));
}

interface LmStudioModel {
  type: string;
  key: string;
  display_name?: string;
  max_context_length?: number;
  loaded_instances: { config?: { context_length?: number } }[];
  capabilities?: { vision?: boolean; trained_for_tool_use?: boolean; reasoning?: { allowed_options?: string[] } };
}

/** Maps LM Studio's native `/api/v1/models` payload to chat models. Pure, so it can be tested without a server. */
export function parseLmStudioModels(models: LmStudioModel[]): ListedModel[] {
  return models
    .filter((m) => m.type === "llm")
    .map((m) => {
      const options = m.capabilities?.reasoning?.allowed_options;
      return {
        id: m.key,
        name: m.display_name,
        loaded: m.loaded_instances.length > 0,
        toolUse: m.capabilities?.trained_for_tool_use ?? false,
        vision: m.capabilities?.vision ?? false,
        reasoning: Boolean(options?.length),
        reasoningOptions: options,
        contextWindow: pickContextWindow(m.loaded_instances[0]?.config?.context_length, m.max_context_length),
      };
    });
}

const postJson = <T>(url: string, body: unknown): Promise<T> => fetchJson<T>(url, { body, timeoutMs: 2500 });

const warnedAssumedWindow = new Set<string>();

/**
 * Ollama serves unloaded models with a small default num_ctx (about 4096) and its /v1 endpoint
 * cannot change it, so that is all we can truthfully assume until /api/ps reports a loaded window.
 */
export const OLLAMA_DEFAULT_CONTEXT = 4096;

/**
 * Ollama's /v1 endpoint cannot set or report context, so ask its native API: /api/ps for the
 * window a loaded model really has, /api/show for the model's own limit when it is not loaded.
 */
async function ollamaContextWindows(baseUrl: string, ids: string[]): Promise<Map<string, { window: number; loaded: boolean }>> {
  const result = new Map<string, { window: number; loaded: boolean }>();
  const ps = await getJson<{ models?: { name?: string; model?: string; context_length?: number }[] }>(`${baseUrl}/api/ps`).catch(() => undefined);
  for (const m of ps?.models ?? []) {
    const id = ids.find((i) => i === m.model || i === m.name);
    if (id && m.context_length) result.set(id, { window: m.context_length, loaded: true });
  }
  await Promise.all(
    ids
      .filter((i) => !result.has(i))
      .map(async (id) => {
        const show = await postJson<{ model_info?: Record<string, unknown> }>(`${baseUrl}/api/show`, { model: id }).catch(() => undefined);
        const entry = Object.entries(show?.model_info ?? {}).find(([k, v]) => k.endsWith(".context_length") && typeof v === "number");
        if (entry) result.set(id, { window: Math.min(OLLAMA_DEFAULT_CONTEXT, entry[1] as number), loaded: false });
      }),
  );
  return result;
}

/** Chat-capable models a server offers. LM Studio's native API adds load state and capabilities. */
export async function listLocalModels(kind: LocalServerKind, baseUrl: string): Promise<LocalModel[]> {
  return (await listModelsDetailed(kind, baseUrl)).map(({ reasoningOptions: _options, ...model }) => model);
}

async function listModelsDetailed(kind: LocalServerKind, baseUrl: string): Promise<ListedModel[]> {
  if (kind === "lmstudio") {
    try {
      const { models } = await getJson<{ models: LmStudioModel[] }>(`${baseUrl}/api/v1/models`);
      return parseLmStudioModels(models);
    } catch {
      /* older LM Studio: try the v0 API */
    }
    try {
      const { data } = await getJson<{
        data: { id: string; type: string; state: string; max_context_length?: number; loaded_context_length?: number; capabilities?: string[] }[];
      }>(`${baseUrl}/api/v0/models`);
      return data
        .filter((m) => m.type === "llm" || m.type === "vlm")
        .map((m) => ({
          id: m.id,
          loaded: m.state === "loaded",
          toolUse: m.capabilities?.includes("tool_use") ?? false,
          vision: m.type === "vlm",
          contextWindow: pickContextWindow(m.state === "loaded" ? m.loaded_context_length : undefined, m.max_context_length),
        }));
    } catch {
      /* older LM Studio: fall back to the OpenAI-compatible listing */
    }
  }
  const { data } = await getJson<{ data: { id: string }[] }>(`${baseUrl}/v1/models`);
  const models: ListedModel[] = data.filter((m) => !/embed/i.test(m.id)).map((m) => ({ id: m.id }));
  if (kind !== "ollama") return models;
  const windows = await ollamaContextWindows(baseUrl, models.map((m) => m.id)).catch(() => new Map<string, { window: number; loaded: boolean }>());
  return models.map((m) => {
    const known = windows.get(m.id);
    if (!known && !warnedAssumedWindow.has(m.id)) {
      warnedAssumedWindow.add(m.id);
      console.warn(`[local] Ollama did not report a context window for ${m.id}; assuming ${OLLAMA_DEFAULT_CONTEXT}.`);
    }
    return { ...m, loaded: known?.loaded, contextWindow: known?.window ?? OLLAMA_DEFAULT_CONTEXT };
  });
}

function prettyName(id: string): string {
  return (id.split("/").pop() ?? id).replace(/[-_]/g, " ").replace(/\b(\w)/g, (c) => c.toUpperCase());
}

const PI_LEVELS = ["minimal", "low", "medium", "high"] as const;

/**
 * Builds Pi's thinking map from the options the server reports. Pi sends
 * `reasoning_effort: map[level] ?? level` for every non-off level (a null entry only hides the
 * level from the picker), so a level we expose must map to a value the server accepts.
 * On/off models expose "off" -> "none" and one on-level, medium -> "medium". LM Studio rejects
 * `reasoning_effort: "on"` with a 400, accepts the graded names, and only logs a harmless
 * "not supported, falling back to 'on'" warning for them. pi-ai cannot omit the field for a
 * non-off level, so that warning is the price of working requests. Never emit "on".
 * Models with low/medium/high expose exactly those.
 */
export function thinkingMapFor(options: string[]): Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", string | null> {
  const graded = PI_LEVELS.some((l) => options.includes(l));
  const level = (l: (typeof PI_LEVELS)[number]) => (graded ? (options.includes(l) ? l : null) : l === "medium" ? "medium" : null);
  return {
    off: options.includes("off") ? "none" : null,
    minimal: level("minimal"),
    low: level("low"),
    medium: level("medium"),
    high: level("high"),
    xhigh: null,
    max: null,
  };
}

/** Windows last advertised per server and model, so a changed load is noticed and re-registered. */
const advertised = new Map<string, number>();
const runtimes = new Map<string, ModelRuntime>();

/** The Pi model shape shared by every local provider (added servers and the built-in runtime). */
export function localPiModel(m: {
  id: string;
  name: string;
  contextWindow: number;
  vision?: boolean;
  /** The reasoning options the server reports; present only for models whose thinking can be switched. */
  thinkingOptions?: string[];
}) {
  return {
    id: m.id,
    name: m.name,
    api: "openai-completions" as const,
    reasoning: false,
    ...(m.thinkingOptions
      ? {
          reasoning: true,
          thinkingLevelMap: thinkingMapFor(m.thinkingOptions),
          compat: { supportsReasoningEffort: true, thinkingFormat: "openai" as const },
        }
      : {}),
    input: (m.vision ? ["text", "image"] : ["text"]) as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: m.contextWindow,
    maxTokens: maxTokensFor(m.contextWindow),
  };
}

type PiLocalModel = ReturnType<typeof localPiModel>;

/** Registers an OpenAI-compatible local endpoint (`baseUrl` without /v1) as a Pi provider. */
export function registerLocalProvider(
  runtime: ModelRuntime,
  id: string,
  provider: { name: string; baseUrl: string; models: PiLocalModel[]; refreshModels: () => Promise<PiLocalModel[]> },
): void {
  runtime.registerProvider(id, {
    name: provider.name,
    baseUrl: `${provider.baseUrl}/v1`,
    api: "openai-completions",
    // Local servers ignore the key, but Pi treats a provider without one as unconfigured.
    apiKey: "local",
    models: provider.models,
    refreshModels: provider.refreshModels,
  });
}

async function providerModels(server: LocalServer, listed?: ListedModel[]) {
  const models = listed ?? (await listModelsDetailed(server.kind, server.baseUrl).catch(() => []));
  return models.map((m) => {
    const contextWindow = m.contextWindow ?? LOCAL_CONTEXT;
    advertised.set(`${server.id}|${m.id}`, contextWindow);
    return localPiModel({
      id: m.id,
      name: `${m.name ?? prettyName(m.id)} (local)`,
      contextWindow,
      vision: m.vision,
      thinkingOptions: server.kind === "lmstudio" && m.reasoning ? m.reasoningOptions : undefined,
    });
  });
}

/** Registers a local server as a Pi provider whose model list refreshes from the server. */
export async function registerLocalServer(runtime: ModelRuntime, server: LocalServer, listed?: ListedModel[]): Promise<void> {
  runtimes.set(server.id, runtime);
  registerLocalProvider(runtime, server.id, {
    name: server.name,
    baseUrl: server.baseUrl,
    models: await providerModels(server, listed),
    refreshModels: () => providerModels(server),
  });
}

/** Whether a model's traffic stays on this machine: an added local server, a loopback URL, or the built-in runtime (also when it points at another host). */
export function isLocalProvider(providerId: string, baseUrl: string | undefined, config: Pick<HostConfig, "localServers">): boolean {
  return providerId === LLAMA_PROVIDER || config.localServers.some((s) => s.id === providerId) || /localhost|127\.0\.0\.1|\[::1\]/.test(baseUrl ?? "");
}

/** Compares servers by origin: no trailing slash or /v1, and localhost / [::1] count as 127.0.0.1. */
const bareUrl = (url: string) => url.replace(/\/+$/, "").replace(/\/v1$/, "").replace(/\/\/(localhost|\[::1\])(?=[:/]|$)/i, "//127.0.0.1");

/** `skipBaseUrl` is the built-in runtime's current URL, so a server it already serves is not also listed as a detected one. */
export async function detectLocalServers(added: LocalServer[], skipBaseUrl?: () => string | undefined): Promise<LocalServerStatus[]> {
  const builtIn = skipBaseUrl?.();
  const candidates = [
    ...KNOWN_SERVERS,
    ...added.filter((a) => !KNOWN_SERVERS.some((k) => k.baseUrl === a.baseUrl)).map(({ kind, name, baseUrl }) => ({ kind, name, baseUrl })),
  ].filter((c) => !builtIn || bareUrl(c.baseUrl) !== bareUrl(builtIn));
  return Promise.all(
    candidates.map(async (c) => {
      const registered = added.find((a) => a.baseUrl === c.baseUrl);
      try {
        const models = await listLocalModels(c.kind, c.baseUrl);
        return { ...c, id: registered?.id ?? c.kind, running: true, added: Boolean(registered), models };
      } catch {
        return { ...c, id: registered?.id ?? c.kind, running: false, added: Boolean(registered), models: [] };
      }
    }),
  );
}

/** Loads in progress, so concurrent prompts share one load instead of each loading another copy of the model. */
const loading = new Map<string, Promise<void>>();

/**
 * LM Studio loads models on first request with its own default context (often 4k), which
 * is too small for an agent. Load explicitly with LOCAL_CONTEXT before the first prompt.
 */
export function ensureLocalModelLoaded(server: LocalServer, modelId: string, onLoading?: () => void): Promise<void> {
  const key = `${server.baseUrl}|${modelId}`;
  let pending = loading.get(key);
  if (!pending) {
    pending = loadIfNeeded(server, modelId, onLoading).finally(() => loading.delete(key));
    loading.set(key, pending);
  }
  return pending;
}

/** Re-registers the provider so Pi sees the context the server actually loaded. */
export async function refreshRegistration(server: LocalServer): Promise<void> {
  const runtime = runtimes.get(server.id);
  if (!runtime) return;
  // A failed or empty listing (e.g. a timeout right after a load) must not wipe the registered models.
  const listed = await listModelsDetailed(server.kind, server.baseUrl).catch(() => []);
  if (listed.length > 0) await registerLocalServer(runtime, server, listed).catch(() => {});
}

async function loadIfNeeded(server: LocalServer, modelId: string, onLoading?: () => void): Promise<void> {
  if (server.kind !== "lmstudio") return;
  if (!(await ensureServerRunning(server))) {
    throw new Error(`${server.name} isn't running at ${server.baseUrl}. Start its server and try again.`);
  }
  const models = await listLocalModels(server.kind, server.baseUrl);
  const model = models.find((m) => m.id === modelId);
  if (!model) return;
  if (model.loaded) {
    // Loaded elsewhere (or earlier) with a window we haven't advertised yet.
    if (advertised.get(`${server.id}|${modelId}`) !== model.contextWindow) await refreshRegistration(server);
    return;
  }
  onLoading?.();
  const res = await fetch(`${server.baseUrl}/api/v1/models/load`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: modelId, context_length: LOCAL_CONTEXT }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`LM Studio could not load ${modelId}: ${(await res.text()).slice(0, 300)}`);
  // LM Studio may have shrunk the requested context to fit memory; re-list to learn the real value.
  await refreshRegistration(server);
}

/** Readies a model just before a prompt. The first preparer whose `matches` is true handles it. */
export interface ModelPreparer {
  matches(model: { provider: string; id: string }): boolean;
  prepare(model: { provider: string; id: string }): Promise<void>;
}

/** Added local servers (LM Studio loads with our context size). */
export function localPreparer(store: ConfigStore, hub: Hub): ModelPreparer {
  const serverFor = (provider: string) => store.config.localServers.find((s) => s.id === provider);
  return {
    matches: (model) => serverFor(model.provider) !== undefined,
    prepare: async (model) => {
      const server = serverFor(model.provider);
      if (!server) return;
      await ensureLocalModelLoaded(server, model.id, () => hub.emit({ type: "toast", level: "info", message: `Loading ${model.id} in ${server.name}…` }));
    },
  };
}

/** The ThreadManager prepare callback: runs the first matching preparer, nothing when none matches. */
export function prepareWith(preparers: ModelPreparer[]): (provider: string, modelId: string) => Promise<void> {
  return async (provider, id) => {
    const model = { provider, id };
    await preparers.find((p) => p.matches(model))?.prepare(model);
  };
}
