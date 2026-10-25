import { readFileSync, statSync } from "node:fs";
import { fetchJson, HttpError } from "@pista/local-runtime";
import type { HostEvent, LlamaModel } from "@pista/protocol";
import type { LlamaRuntime } from "./llama-runtime.ts";

/** `<org>/<repo>:<quant>`, the form the router accepts for downloads. Strict, because it ends up in a request body. */
const SPEC = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}:[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
export const isModelSpec = (value: string): boolean => SPEC.test(value);

/** Context a model gets when neither the router nor the preset says. Matches DEFAULT_MODELS_INI. */
export const DEFAULT_CONTEXT = 32_768;

/** Below this window Pista's ~13k-token prompt prefix plus the Pi SDK's 4k safety margin leaves no room for replies. */
export const MIN_USEFUL_CONTEXT = 24_576;
export const CONTEXT_TOO_SMALL_MESSAGE =
  "Context too small for Pista: the system prompt and tools use about 13k tokens, so replies will be cut off. Raise `c` in models.ini (default is now 32k).";
const REQUEST_TIMEOUT_MS = 10_000;

/** One `/models` entry. Only the fields Pista reads. */
export interface RouterEntry {
  id: string;
  status?: { value?: string; args?: string[] };
  context_length?: number;
  meta?: { n_ctx?: number; size?: number };
}

/** Parses the preset INI into `{ section: { key: value } }`. Comments (`;` `#`) and unknown lines are ignored. */
export function parseModelsIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section: Record<string, string> | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) section = out[header[1]!.trim()] ??= {};
    else if (section) {
      const eq = line.indexOf("=");
      if (eq > 0) section[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }
  return out;
}

const positive = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
/** Like `positive` but keeps 0, which llama.cpp reads as "use the model's trained context". */
const nonNegative = (value: unknown): number | undefined => {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** The `--ctx-size` / `-c` value in a child's argv, if any. */
function ctxFromArgs(args: string[] | undefined): number | undefined {
  const at = args?.findIndex((a) => a === "--ctx-size" || a === "-c") ?? -1;
  return at >= 0 ? nonNegative(args![at + 1]) : undefined;
}

/**
 * The context an unloaded model will get: its own preset section, else `[*]`, else the default,
 * never above what it was trained with. 0 means the trained context. The router reports the
 * trained value as `context_length`.
 */
export function plannedContext(entry: RouterEntry, ini: Record<string, Record<string, string>>): number {
  const configured =
    ctxFromArgs(entry.status?.args) ?? nonNegative(ini[entry.id]?.c ?? ini[entry.id]?.["ctx-size"] ?? ini["*"]?.c ?? ini["*"]?.["ctx-size"]) ?? DEFAULT_CONTEXT;
  const trained = positive(entry.context_length);
  if (configured === 0) return trained ?? DEFAULT_CONTEXT;
  return trained ? Math.min(configured, trained) : configured;
}

export function toLlamaModel(entry: RouterEntry, ini: Record<string, Record<string, string>>): LlamaModel {
  const value = entry.status?.value;
  const status: LlamaModel["status"] =
    value === "loaded" || value === "loading" || value === "downloading" ? value : value === "unloaded" || value === "sleeping" ? "unloaded" : "error";
  const loaded = status === "loaded";
  const contextWindow = loaded ? (positive(entry.meta?.n_ctx) ?? plannedContext(entry, ini)) : plannedContext(entry, ini);
  return {
    id: entry.id,
    name: entry.id,
    loaded,
    status,
    contextWindow,
    trainedContext: positive(entry.context_length),
    sizeBytes: positive(entry.meta?.size),
    ...(status === "error"
      ? { message: `The router reports status "${value ?? "unknown"}".` }
      : contextWindow < MIN_USEFUL_CONTEXT
        ? { message: CONTEXT_TOO_SMALL_MESSAGE }
        : {}),
  };
}

/** Incremental Server-Sent Events parser: feed it text chunks that may end mid-line; it calls `onData` per event, with the `event:` name if there was one. */
export function createSseParser(onData: (data: string, event?: string) => void): (chunk: string) => void {
  let buffer = "";
  let data: string[] = [];
  let name: string | undefined;
  return (chunk) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (line === "") {
        if (data.length > 0) onData(data.join("\n"), name);
        data = [];
        name = undefined;
      } else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      else if (line.startsWith("event:")) name = line.slice(6).trim() || undefined;
    }
  };
}

interface RouterEvent {
  model?: string;
  event?: string;
  data?: { status?: string; error?: string; progress?: Record<string, { done?: number; total?: number }> };
}

export interface LlamaModelsOptions {
  emit: (event: HostEvent) => void;
  /** Called with the fresh list after every change, e.g. to re-register the Pi provider. */
  onChange?: (models: LlamaModel[]) => void;
  /** Whether the user turned the runtime on. A managed runtime that is off is never installed or started from here. */
  enabled?: () => boolean;
  /** Minimum gap between `llama.download` progress events. */
  progressIntervalMs?: number;
  /** How long a download may go without any router event before the router is asked about it. */
  stallTimeoutMs?: number;
  /** Tests only. */
  fetch?: typeof fetch;
  loadTimeoutMs?: number;
  unloadTimeoutMs?: number;
}

/** Client for the llama.cpp router REST API (`/models`, `/models/load`, `/models/unload`, `/models/sse`). */
export class LlamaModels {
  private watching: AbortController | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  /** Last progress emitted per spec, for throttling. */
  private lastProgress = new Map<string, number>();
  private reasoning = new Map<string, boolean>();
  /** Specs whose download is in progress; only these may produce a `llama.download` error. */
  private downloading = new Set<string>();
  /** Last bytes/total seen per spec, so the final event is not a 0. */
  private lastSeen = new Map<string, { bytes: number; total?: number }>();
  /** Per spec: fires when no event arrived for `stallTimeoutMs`. */
  private watchdogs = new Map<string, ReturnType<typeof setTimeout>>();
  private loads = new Map<string, Promise<void>>();
  private ini: { mtimeMs: number; parsed: Record<string, Record<string, string>> } | undefined;

  constructor(
    private runtime: LlamaRuntime,
    private options: LlamaModelsOptions,
  ) {}

  private get http(): typeof fetch {
    return this.options.fetch ?? fetch;
  }

  /** Starts the runtime if needed and keeps its idle timer off while `fn` runs. */
  private async call<T>(fn: (base: string) => Promise<T>): Promise<T> {
    if (this.runtime.mode === "managed" && !this.runtime.baseUrl && this.options.enabled?.() === false) {
      throw new Error("The built-in llama.cpp runtime is turned off. Enable it in Settings first.");
    }
    return this.runtime.touch(fn); // starts the router if needed
  }

  private async request<T>(base: string, path: string, body?: unknown): Promise<T> {
    try {
      return await fetchJson<T>(`${base}${path}`, { body, timeoutMs: REQUEST_TIMEOUT_MS, fetch: this.http });
    } catch (error) {
      if (error instanceof HttpError) throw new Error(`llama.cpp ${path}: ${error.detail || `HTTP ${error.status}`}`);
      throw error;
    }
  }

  /** models.ini, re-read only when its mtime changes. */
  private readIni(): Record<string, Record<string, string>> {
    try {
      const path = this.runtime.paths.ini;
      const { mtimeMs } = statSync(path);
      if (this.ini?.mtimeMs !== mtimeMs) this.ini = { mtimeMs, parsed: parseModelsIni(readFileSync(path, "utf8")) };
      return this.ini.parsed;
    } catch {
      this.ini = undefined;
      return {};
    }
  }

  /**
   * Whether a loaded model's chat template has a thinking switch; unloaded models keep the last answer.
   * autoload=false matters: without it, asking about a model that is being unloaded loads it again.
   */
  private async detectReasoning(base: string, id: string): Promise<boolean> {
    try {
      const props = await this.request<{ chat_template?: string }>(base, `/props?model=${encodeURIComponent(id)}&autoload=false`);
      const found = /enable_thinking|<think>|reasoning_effort/.test(props.chat_template ?? "");
      this.reasoning.set(id, found);
      return found;
    } catch {
      return this.reasoning.get(id) ?? false;
    }
  }

  async list(): Promise<LlamaModel[]> {
    return this.call(async (base) => {
      const { data } = await this.request<{ data?: RouterEntry[] }>(base, "/models");
      const ini = this.readIni();
      return Promise.all(
        (data ?? []).map(async (entry) => {
          const model = toLlamaModel(entry, ini);
          const reasoning = model.loaded ? (this.reasoning.get(model.id) ?? (await this.detectReasoning(base, model.id))) : this.reasoning.get(model.id);
          return reasoning === undefined ? model : { ...model, reasoning };
        }),
      );
    });
  }

  /** Lists, tells the UI and the provider. Returns the list. */
  async refresh(): Promise<LlamaModel[]> {
    const models = await this.list();
    this.options.emit({ type: "llama.models", models });
    this.options.onChange?.(models);
    return models;
  }

  /** Coalesces bursts of router events into one refresh. */
  private scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh().catch(() => {}), 200);
    this.refreshTimer.unref?.();
  }

  /** Polls until `done`, the model reports an error, or the deadline. Gives up at once if the router died. */
  private async waitFor(id: string, done: (m: LlamaModel) => boolean, timeoutMs: number): Promise<LlamaModel | undefined> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (!this.runtime.baseUrl) throw new Error("The llama.cpp router stopped.");
      const model = (await this.list()).find((m) => m.id === id);
      if (model && (done(model) || model.status === "error")) return model;
      if (Date.now() > deadline) return model;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  /** Loads a model and resolves once it is loaded. Concurrent calls for one id share a single load. */
  load(id: string): Promise<void> {
    let pending = this.loads.get(id);
    if (!pending) {
      pending = this.loadNow(id).finally(() => this.loads.delete(id));
      this.loads.set(id, pending);
    }
    return pending;
  }

  private async loadNow(id: string): Promise<void> {
    const current = (await this.list()).find((m) => m.id === id);
    if (current?.loaded) return;
    if (current?.status === "downloading") throw new Error(`${id} is still downloading.`);
    if (current?.status !== "loading") await this.call((base) => this.request(base, "/models/load", { model: id }));
    void this.refresh().catch(() => {}); // show "loading" right away
    const model = await this.waitFor(id, (m) => m.loaded, this.options.loadTimeoutMs ?? 180_000);
    await this.refresh();
    if (!model?.loaded) throw new Error(model?.status === "error" ? (model.message ?? `${id} failed to load.`) : `${id} did not finish loading in time.`);
  }

  async unload(id: string): Promise<void> {
    await this.call((base) => this.request(base, "/models/unload", { model: id }));
    const model = await this.waitFor(id, (m) => m.status === "unloaded", this.options.unloadTimeoutMs ?? 15_000);
    await this.refresh();
    if (model && model.status !== "unloaded") throw new Error(`${id} is still ${model.status} after unloading.`);
  }

  /** Starts a download and returns; `watchProgress` reports how it goes. */
  async download(spec: string): Promise<void> {
    if (!isModelSpec(spec)) throw new Error(`"${spec}" is not a model spec. Use <org>/<repo>:<quant>, e.g. ggml-org/stories15M_MOE:Q8_0.`);
    // Asked before the POST: afterwards a fresh download is listed too, in a state that says nothing about the cache.
    const before = (await this.list().catch(() => [])).find((m) => m.id === spec);
    await this.call((base) => this.request(base, "/models", { model: spec }));
    if (before && before.status !== "downloading" && before.status !== "error") {
      this.options.emit({ type: "llama.download", spec, bytes: before.sizeBytes ?? 0, ...(before.sizeBytes ? { total: before.sizeBytes } : {}), done: true, phase: "done" });
    } else {
      // Already in flight (second request): keep the bytes the UI has, only restart the stall timer.
      if (!this.downloading.has(spec)) this.options.emit({ type: "llama.download", spec, bytes: 0, phase: "starting" });
      this.downloading.add(spec);
      this.armWatchdog(spec);
    }
    this.scheduleRefresh();
  }

  private endDownload(spec: string) {
    this.downloading.delete(spec);
    this.lastProgress.delete(spec);
    this.lastSeen.delete(spec);
    clearTimeout(this.watchdogs.get(spec));
    this.watchdogs.delete(spec);
  }

  private finishDownload(spec: string) {
    const last = this.lastSeen.get(spec);
    this.endDownload(spec);
    this.options.emit({ type: "llama.download", spec, bytes: last?.bytes ?? 0, ...(last?.total ? { total: last.total } : {}), done: true, phase: "done" });
    this.scheduleRefresh();
  }

  /** (Re)starts the stall timer of a download; every router event for the spec calls this again. */
  private armWatchdog(spec: string) {
    clearTimeout(this.watchdogs.get(spec));
    const ms = this.options.stallTimeoutMs ?? 45_000;
    const timer = setTimeout(() => void this.onStall(spec, ms), ms);
    timer.unref?.();
    this.watchdogs.set(spec, timer);
  }

  private async onStall(spec: string, ms: number) {
    if (!this.downloading.has(spec)) return;
    // list() would start a stopped managed runtime. A stopped one means clear() is on its way and settles this download.
    if (!this.runtime.baseUrl) return this.armWatchdog(spec);
    const models = await this.list().catch(() => undefined);
    if (!this.downloading.has(spec)) return;
    const model = models?.find((m) => m.id === spec);
    if (!models || model?.status === "downloading") this.armWatchdog(spec); // router unreachable or still at it: keep waiting
    else if (model && model.status !== "error") this.finishDownload(spec);
    else this.downloadFailed(spec, `No progress from the runtime for ${Math.round(ms / 1000)} s`);
  }

  /**
   * Called before a prompt to a managed model: makes sure the router is up and the model is loaded,
   * so the first request neither waits on an autoload nor hits "model is not loaded".
   */
  async prepare(id: string, onLoading?: () => void): Promise<void> {
    const model = (await this.list()).find((m) => m.id === id);
    if (!model) throw new Error(`The built-in llama.cpp runtime has no model "${id}".`);
    if (model.loaded) return;
    onLoading?.();
    await this.load(id);
  }

  private downloadFailed(spec: string, error: string) {
    if (!this.downloading.has(spec)) return; // a failed load is not a failed download
    this.endDownload(spec);
    this.options.emit({ type: "llama.download", spec, bytes: 0, error, phase: "error" });
  }

  private onRouterEvent(event: RouterEvent) {
    const spec = event.model;
    if (!spec || spec === "*") {
      // models_reload names no model ("*"): the set of models changed, so list again.
      if (event.event === "models_reload" || spec === "*") this.scheduleRefresh();
      return;
    }
    if (this.downloading.has(spec)) this.armWatchdog(spec);
    switch (event.event) {
      case "download_progress": {
        this.downloading.add(spec);
        this.armWatchdog(spec);
        const files = Object.values(event.data?.progress ?? {});
        const bytes = files.reduce((n, f) => n + (f.done ?? 0), 0);
        const total = files.reduce((n, f) => n + (f.total ?? 0), 0);
        this.lastSeen.set(spec, { bytes, ...(total > 0 ? { total } : {}) });
        const now = Date.now();
        if (now - (this.lastProgress.get(spec) ?? 0) < (this.options.progressIntervalMs ?? 250)) return;
        this.lastProgress.set(spec, now);
        this.options.emit({ type: "llama.download", spec, bytes, ...(total > 0 ? { total } : {}), phase: "downloading" });
        this.runtime.keepAlive(); // a long download must not idle the router out
        return;
      }
      case "download_finished":
        this.finishDownload(spec);
        return;
      case "model_status":
      case "status_change":
        if (event.data?.status === "downloading" && !this.downloading.has(spec)) {
          this.downloading.add(spec);
          this.armWatchdog(spec);
        }
        if (event.data?.error || event.data?.status === "error") this.downloadFailed(spec, event.data.error ?? "The router reported an error.");
        if (!(event.event === "status_change" && event.data?.progress)) this.scheduleRefresh();
        return;
      default:
        if (/error|fail/i.test(event.event ?? "")) this.downloadFailed(spec, event.data?.error ?? event.event ?? "Download failed.");
    }
  }

  /**
   * After every (re)connect of the event stream: events may have been missed, so list again and tell the UI
   * where each download stands (finished while away, or the bytes seen so far).
   */
  private async resync() {
    const models = await this.refresh().catch(() => undefined);
    for (const spec of [...this.downloading]) {
      const model = models?.find((m) => m.id === spec);
      if (model && model.status !== "downloading" && model.status !== "error") this.finishDownload(spec);
      else {
        const seen = this.lastSeen.get(spec);
        this.options.emit({ type: "llama.download", spec, bytes: seen?.bytes ?? 0, ...(seen?.total ? { total: seen.total } : {}), phase: seen ? "downloading" : "starting" });
      }
    }
  }

  /** Opens the router's event stream and resolves when it ends. Does not start the runtime. */
  async watchProgress(signal: AbortSignal): Promise<void> {
    const base = this.runtime.baseUrl;
    if (!base) return;
    const res = await this.http(`${base}/models/sse`, { signal, headers: { accept: "text/event-stream" } });
    if (!res.ok || !res.body) throw new Error(`llama.cpp /models/sse: HTTP ${res.status}`);
    await this.resync();
    const push = createSseParser((data, name) => {
      try {
        const event = JSON.parse(data) as RouterEvent;
        this.onRouterEvent(event.event || !name ? event : { ...event, event: name });
      } catch {
        /* keep-alive or malformed event */
      }
    });
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      push(decoder.decode(value, { stream: true }));
    }
  }

  /** Keeps `watchProgress` running (reconnecting) until `stopWatching`. Idempotent. */
  startWatching() {
    if (this.watching) return;
    const abort = (this.watching = new AbortController());
    void (async () => {
      let delay = 1000;
      let logged = false;
      while (!abort.signal.aborted) {
        const started = Date.now();
        await this.watchProgress(abort.signal).catch((error: Error) => {
          if (!logged && !abort.signal.aborted) {
            // undici ends an idle body after a few minutes: routine, not a fault.
            if (/terminated/.test(error.message)) console.info(`[llama] model event stream ended, reconnecting: ${error.message}`);
            else console.warn(`[llama] model event stream lost, retrying: ${error.message}`);
          }
          logged = true;
        });
        if (abort.signal.aborted) return;
        if (Date.now() - started > 5000) delay = 1000; // it was healthy for a while: start the backoff over
        const cap = this.downloading.size > 0 ? 10_000 : 30_000; // a download in progress wants its progress back soon
        await new Promise((resolve) => setTimeout(resolve, Math.min(delay, cap)));
        delay = Math.min(delay * 2, 30_000);
      }
    })();
  }

  stopWatching() {
    this.watching?.abort();
    this.watching = undefined;
    clearTimeout(this.refreshTimer);
    this.lastProgress.clear();
    this.lastSeen.clear();
    this.downloading.clear();
    for (const timer of this.watchdogs.values()) clearTimeout(timer);
    this.watchdogs.clear();
  }

  /** The router went away: stop watching and tell the UI the list is empty. */
  clear() {
    for (const spec of [...this.downloading]) this.downloadFailed(spec, "The llama.cpp runtime stopped.");
    this.stopWatching();
    this.options.emit({ type: "llama.models", models: [] });
  }
}
