import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { LlamaRuntimeStatus, MethodName, Methods } from "@pista/protocol";
import { CLIENT_DIR, type ConfigStore } from "./config.ts";
import type { Hub } from "./hub.ts";
import { inspectHub, searchHub } from "./llama-hub.ts";
import { LlamaModels } from "./llama-models.ts";
import { LLAMA_PROVIDER, LlamaProvider } from "./llama-provider.ts";
import { LlamaRuntime } from "./llama-runtime.ts";
import type { ModelPreparer } from "./local.ts";
import { assertProviderAllowed } from "./policy-access.ts";

type LlamaMethod = Extract<MethodName, `llama.${string}`>;
type LlamaHandlers = { [M in LlamaMethod]: (params: Methods[M]["params"]) => Promise<Methods[M]["result"]> | Methods[M]["result"] };

export interface LlamaOptions {
  hub: Hub;
  store: ConfigStore;
  /** Pi's model runtime; the built-in runtime registers itself as the `llama.cpp` provider here. */
  models: ModelRuntime;
  /** Re-creates idle sessions after the provider disappears. Called lazily, so the ThreadManager may be built after this. */
  reloadIdle?: () => Promise<void>;
}

/** The built-in llama.cpp runtime wired to the hub, the config and Pi: one object with its RPC handlers. */
export function createLlama({ hub, store, models: pi, reloadIdle }: LlamaOptions) {
  // The runtime reports to the hub and to the provider, which does not exist yet; sinks added later keep construction order safe.
  const statusSinks: ((status: LlamaRuntimeStatus) => void)[] = [(status) => hub.emit({ type: "llama.status", status })];
  const runtime = new LlamaRuntime({ home: join(CLIENT_DIR, "llama"), bundleDir: process.env.PISTA_LLAMA_BUNDLE_DIR?.trim() || undefined, onStatus: (status) => statusSinks.forEach((sink) => sink(status)) });
  const models = new LlamaModels(runtime, {
    emit: (event) => hub.emit(event),
    onChange: (list) => provider.register(list), // only fires after construction, once `provider` exists
    enabled: () => store.config.llamaEnabled,
  });
  const provider = new LlamaProvider(pi, () => runtime.baseUrl, models);
  statusSinks.push((status) => provider.onStatus(status));

  const setEnabled = (on: boolean) => hub.emit({ type: "config.changed", config: store.patchConfig({ llamaEnabled: on }, { userSet: true }), configSources: store.sources() });
  // Enabling persists only once it works, so a failed install is not retried on every start. Disabling and
  // removing persist at once and reload idle sessions afterwards, so they drop the vanished provider.
  const handlers: LlamaHandlers = {
    "llama.status": () => runtime.status(),
    "llama.enable": () => {
      store.assertUnlocked({ llamaEnabled: true });
      assertProviderAllowed(store.managedPolicy, LLAMA_PROVIDER);
      if (runtime.unavailable) throw new Error(runtime.unavailable);
      // Failures surface as llama.status events.
      void runtime.ensureRunning().then(() => setEnabled(true), () => {});
    },
    "llama.disable": async () => {
      store.assertUnlocked({ llamaEnabled: false });
      runtime.disable();
      setEnabled(false);
      await reloadIdle?.();
    },
    "llama.remove": async () => {
      store.assertUnlocked({ llamaEnabled: false });
      setEnabled(false);
      await runtime.remove();
      await reloadIdle?.();
    },
    "llama.models.list": () => models.refresh(),
    "llama.models.load": ({ id }) => models.load(id),
    "llama.models.unload": ({ id }) => models.unload(id),
    "llama.models.download": ({ spec }) => {
      assertProviderAllowed(store.managedPolicy, LLAMA_PROVIDER);
      return models.download(spec);
    },
    "llama.models.search": ({ query }) => searchHub(query),
    "llama.models.inspect": ({ id }) => inspectHub(id),
  };

  const prepare: ModelPreparer = {
    matches: (model) => model.provider === LLAMA_PROVIDER,
    prepare: async (model) => {
      await models.prepare(model.id, () => hub.emit({ type: "toast", level: "info", message: `Loading ${model.id}…` }));
      await provider.sync(); // the router may have restarted on another port, or loaded with another window
    },
  };

  return {
    runtime,
    models,
    provider,
    handlers,
    prepare,
    /** Only a managed runtime the user enabled starts, and never in the way of startup. */
    start() {
      if (store.config.llamaEnabled && runtime.mode === "managed" && !runtime.unavailable) {
        void runtime.ensureRunning().catch((error) => console.error(`[llama] ${(error as Error).message}`));
      }
      // An external router is already running, so there is no status change to wait for.
      if (runtime.mode === "external") provider.onStatus(runtime.status());
    },
    stop: () => runtime.stop(),
  };
}
