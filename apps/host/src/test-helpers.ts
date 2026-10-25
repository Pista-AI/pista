// Shared setup for host tests. Not imported from production code, so the esbuild bundle (from index.ts) excludes it.
// Pi reads its agent dir and Pista its home dir at import time, so everything that touches them is imported
// dynamically here and callers must run setupHome() before the first makeManager()/fauxModels().
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ManagedPolicy } from "@pista/protocol";
import type { Hub } from "./hub.ts";
import type { ThreadManager } from "./threads.ts";

export interface TestHome {
  root: string;
  home: string;
  agentDir: string;
  projectDir: string;
}

/**
 * Points PISTA_HOME and PI_CODING_AGENT_DIR at a fresh temp dir and creates a project folder.
 * `cleanup: "exit"` is for files that register tests after top-level awaits, where a root `after` would fire early.
 */
export function setupHome(prefix: string, opts: { cleanup?: "after" | "exit" } = {}): TestHome {
  const root = mkdtempSync(join(tmpdir(), `pista-${prefix}-`));
  const dirs: TestHome = { root, home: join(root, "home"), agentDir: join(root, "agent"), projectDir: join(root, "project") };
  process.env.PISTA_HOME = dirs.home;
  process.env.PI_CODING_AGENT_DIR = dirs.agentDir;
  for (const dir of [dirs.agentDir, dirs.projectDir]) mkdirSync(dir, { recursive: true });
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  if (opts.cleanup === "exit") process.on("exit", cleanup);
  else after(cleanup);
  return dirs;
}

export interface ManagerOptions {
  /** Added to the config store as a project; omit for a "restarted host" that reads it from disk. */
  projectDir?: string;
  models?: ModelRuntime;
  hub?: Hub;
  prepareModel?: ConstructorParameters<typeof ThreadManager>[3];
  goalJudge?: ConstructorParameters<typeof ThreadManager>[4];
  /** Managed policy the config store is built with. */
  policy?: ManagedPolicy;
  /** Dispose the manager when the test file finishes (default true). */
  dispose?: boolean;
}

/** A fresh ConfigStore, Hub and ThreadManager. Each call reads config from disk, so a second call models a host restart. */
export async function makeManager(opts: ManagerOptions = {}) {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const { ConfigStore } = await import("./config.ts");
  const { Hub } = await import("./hub.ts");
  const { ThreadManager } = await import("./threads.ts");
  const models = opts.models ?? (await ModelRuntime.create({ allowModelNetwork: false }));
  const store = new ConfigStore(opts.policy ? { policy: opts.policy, source: "/test-policy.json", sourceKind: "file", warnings: [] } : undefined);
  const project = opts.projectDir ? store.addProject(opts.projectDir) : undefined;
  const hub = opts.hub ?? new Hub();
  const manager = new ThreadManager(store, hub, models, opts.prepareModel, opts.goalJudge);
  if (opts.dispose !== false) after(() => manager.dispose());
  return { manager, store, hub, models, project: project! };
}

/**
 * Registers pi-ai's faux provider on `models` (a fresh offline runtime by default).
 * pnpm keeps pi-ai next to pi-coding-agent but not in the host's own node_modules; it is not a declared
 * dependency, so it is loaded untyped through the real path.
 */
export async function fauxModels(models?: ModelRuntime, opts: { contextWindow?: number } = {}) {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const piAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  const piAiEntry = join(dirname(dirname(dirname(realpathSync(piAgentEntry)))), "pi-ai/dist/index.js");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const piAi: any = await import(pathToFileURL(piAiEntry).href);
  const faux = piAi.fauxProvider(opts.contextWindow ? { models: [{ id: "faux-model", contextWindow: opts.contextWindow }] } : {});
  const runtime = models ?? (await ModelRuntime.create({ allowModelNetwork: false }));
  runtime.registerNativeProvider(faux.provider);
  const model = faux.getModel();
  return { piAi, faux, models: runtime, ref: { provider: model.provider as string, id: model.id as string } };
}

/** The manager's private map of loaded threads; `T` narrows it to what a test reads. */
export function liveOf<T = unknown>(manager: ThreadManager): Map<string, T> {
  return (manager as unknown as { live: Map<string, T> }).live;
}
