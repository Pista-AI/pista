import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { LlamaModel, LlamaRuntimeStatus } from "@pista/protocol";
import { DEFAULT_CONTEXT, MIN_USEFUL_CONTEXT, type LlamaModels } from "./llama-models.ts";
import { LLAMA_PROVIDER, localPiModel, registerLocalProvider } from "./local.ts";

export { LLAMA_PROVIDER, MIN_USEFUL_CONTEXT };

/** One Pi model per router model, with the window the router really loaded (or will load). */
export function toPiModel(model: LlamaModel) {
  return localPiModel({
    id: model.id,
    name: `${model.name} (built-in)`,
    contextWindow: model.contextWindow ?? DEFAULT_CONTEXT,
    // On/off thinking: "off" sends reasoning_effort "none" (verified for Qwen3).
    thinkingOptions: model.reasoning ? ["off"] : undefined,
  });
}

/** A model that is still downloading cannot be chosen yet. */
const ready = (list: LlamaModel[]) => list.filter((m) => m.status !== "downloading");

/**
 * Keeps Pi's `llama.cpp` provider in step with the router: registered with the current models while
 * the runtime is running, removed when it is not. The base URL is re-read on every registration
 * because a managed router gets a new port each time it starts.
 */
export class LlamaProvider {
  private running = false;
  private warned = new Set<string>();

  constructor(
    private pi: ModelRuntime,
    private baseUrl: () => string | undefined,
    private models: LlamaModels,
  ) {}

  /** Registers (or re-registers) the provider with `list`; removes it when the router is not reachable. */
  register(list: LlamaModel[]): void {
    const base = this.baseUrl();
    if (!base) return this.unregister();
    for (const m of list) {
      if (m.message && m.status !== "error" && m.contextWindow !== undefined && m.contextWindow < MIN_USEFUL_CONTEXT && !this.warned.has(m.id)) {
        this.warned.add(m.id);
        console.warn(`[llama] ${m.id}: ${m.message}`);
      }
    }
    registerLocalProvider(this.pi, LLAMA_PROVIDER, {
      name: "llama.cpp (built-in)",
      baseUrl: base,
      models: ready(list).map(toPiModel),
      refreshModels: async () => ready(await this.models.list().catch(() => [])).map(toPiModel),
    });
  }

  unregister(): void {
    this.pi.unregisterProvider(LLAMA_PROVIDER);
  }

  /** Re-lists the router and registers the result. Never throws: a router that is down just has no models. */
  async sync(): Promise<void> {
    try {
      if (this.baseUrl()) this.register(await this.models.refresh());
      else this.unregister();
    } catch {
      /* the next status change or list retries */
    }
  }

  /** Wire to the runtime's status events: sync when it comes up, tear down when it goes away. */
  onStatus(status: LlamaRuntimeStatus): void {
    const running = status.state === "running";
    if (running === this.running) return;
    this.running = running;
    if (running) {
      this.models.startWatching();
      void this.sync();
    } else {
      this.models.clear();
      this.unregister();
    }
  }
}
