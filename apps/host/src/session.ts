import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type InlineExtension,
  type ModelRuntime,
  type ResourceDiagnostic,
  type SessionManager,
  type PackageSource,
  SettingsManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import type { ManagedPolicy, ModelRef } from "@pista/protocol";
import { capModel } from "./models.ts";
import { piAgentDir } from "./pi-env.ts";

export interface BuildSessionOptions {
  cwd: string;
  /** Whether Pi may load the project's `.pi/` resources (see `resolveProjectTrust`). Omitted means untrusted. */
  projectTrusted?: boolean;
  models: ModelRuntime;
  /** Initial model; applied only to sessions that have no entries yet. */
  model: ModelRef | undefined;
  /** Pista's `config.defaultModel`. Pi's settings.json `defaultProvider`/`defaultModel` are rewritten to match it on every build. */
  defaultModel?: ModelRef;
  sessionManager?: SessionManager;
  /** Tool allowlist; omitted keeps Pi's defaults. */
  tools?: string[];
  extensionFactories: InlineExtension[];
  additionalExtensionPaths?: string[];
  appendSystemPrompt: string[];
  /** Skills the policy refuses are dropped from the loader (they are not tools); omitted keeps all. */
  skillAllowed?: (name: string) => boolean;
  /** Clamp for the model's per-response output cap (`HostConfig.maxOutputTokens`). */
  maxOutputTokens?: number;
  /** Identifies local models; they get compaction thresholds scaled to their window (see `localCompactionSettings`). */
  isLocal?: (model: { provider: string; id: string; baseUrl?: string }) => boolean;
  /** Managed `extensions` policy to apply to Pi's `packages` setting before resources load; omitted leaves the setting alone. */
  packages?: PackageSync;
}

/** The policy's package rules plus the sources it installed last time and a callback to remember the new list (see `ConfigStore.packageSync`). */
export interface PackageSync {
  rules: ManagedPolicy["extensions"];
  previous: string[];
  record(managed: string[]): void;
}

export interface CompactionOverride {
  reserveTokens: number;
  keepRecentTokens: number;
}

/** Pi SDK safety margin (4096) plus a usable reply (2048). */
const MIN_RESERVE_TOKENS = 4096 + 2048;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Compaction thresholds for a model with the given context window. Pi compacts when the context
 * passes `window - reserveTokens`, and keeps `keepRecentTokens` verbatim. Its defaults (16384 and
 * 20000) exceed a small local window, so nothing is ever left to summarise and compaction is a
 * silent no-op. Scaling both to the window makes it fire at roughly 78% of it.
 */
export function localCompactionSettings(contextWindow: number): CompactionOverride {
  // The Pi SDK clamps each reply to `window - prompt - 4096` (CONTEXT_SAFETY_TOKENS), so replies shrink to
  // one token once the prompt passes `window - 4096`. Compaction fires at `window - reserveTokens`, so the
  // reserve must be at least that safety margin plus room for a reply (4096 + 2048), or the clamp bites first.
  // Windows too small for that (the 40% cap) cannot be helped here.
  const reserveTokens = Math.min(clamp(Math.round(contextWindow * 0.22), MIN_RESERVE_TOKENS, 16384), Math.floor(contextWindow * 0.4));
  let keepRecentTokens = clamp(Math.round(contextWindow * 0.33), 2048, 20000);
  // Reserve and kept tail must both fit in the window with room to spare.
  keepRecentTokens = Math.max(1, Math.min(keepRecentTokens, contextWindow - reserveTokens - 1024));
  return { reserveTokens, keepRecentTokens };
}

/**
 * The user's real settings (global and project) with per-model compaction overrides for local
 * models layered on in memory; nothing is written to disk. Overrides are computed when a session
 * is built, so a session keeps the window it was created with; a local server that appears or
 * changes its context size later applies to new sessions only.
 */
export function buildSettings(
  cwd: string,
  agentDir: string,
  models: ModelRuntime,
  isLocal?: BuildSessionOptions["isLocal"],
  projectTrusted = false,
): SettingsManager {
  // Pi defaults to trusting every project, so the flag is always passed. Untrusted projects contribute no
  // project settings, and Pi's MCP extension reads trust from this manager too (no `.pi/mcp.json`).
  const settings = SettingsManager.create(cwd, agentDir, { projectTrusted });
  reapplyCompactionOverrides(settings, models, isLocal);
  return settings;
}

/**
 * Layers the local-model compaction overrides onto `settings`. Call it again after anything that
 * makes Pi save settings (`session.setModel` does, via setDefaultModelAndProvider): the save
 * rebuilds settings from the files and drops in-memory overrides.
 */
export function reapplyCompactionOverrides(settings: SettingsManager, models: ModelRuntime, isLocal?: BuildSessionOptions["isLocal"]): void {
  if (!isLocal) return;
  const modelOverrides: Record<string, CompactionOverride> = {};
  for (const model of models.getModels()) {
    if (model.contextWindow > 0 && isLocal(model)) modelOverrides[`${model.provider}/${model.id}`] = localCompactionSettings(model.contextWindow);
  }
  if (Object.keys(modelOverrides).length) settings.applyOverrides({ compaction: { modelOverrides } });
}

const sourceOf = (entry: PackageSource): string => (typeof entry === "string" ? entry : entry.source);

/**
 * Makes Pi's global `packages` setting match the managed policy: every managed source is present,
 * sources a former policy installed and this one dropped are removed, and with `allowUserPackages: false`
 * every other entry goes too. Saves only on a change. Returns the new managed list and what it did, one note per line.
 */
export function syncManagedPackages(settings: SettingsManager, rules: ManagedPolicy["extensions"], previous: string[]): { managed: string[]; packages: PackageSource[]; changed: boolean; notes: string[] } {
  const managed = rules?.packages ?? [];
  const current = settings.getGlobalSettings().packages ?? [];
  const notes: string[] = [];
  let next: PackageSource[];
  if (rules?.allowUserPackages === false) {
    next = [...managed];
    const dropped = current.map(sourceOf).filter((source) => !managed.includes(source));
    if (dropped.length) notes.push(`removed user packages: ${dropped.join(", ")}`);
  } else {
    const stale = previous.filter((source) => !managed.includes(source));
    next = current.filter((entry) => !stale.includes(sourceOf(entry)));
    for (const source of managed) if (!next.some((entry) => sourceOf(entry) === source)) next.push(source);
  }
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  if (changed) settings.setPackages(next);
  return { managed, packages: next, changed, notes };
}

/**
 * Writes the policy's packages into `settings` and checks the write: Pi's flush() never throws (it records errors),
 * so a failure would otherwise leave the policy silently unapplied. Throws when the write failed; the managed list
 * is recorded only after it succeeded.
 */
async function applyManagedPackages(settings: SettingsManager, sync: PackageSync, models: ModelRuntime, isLocal?: BuildSessionOptions["isLocal"]): Promise<void> {
  const result = syncManagedPackages(settings, sync.rules, sync.previous);
  for (const note of result.notes) console.log(`[pista-host] managed policy: ${note}`);
  if (result.changed) {
    await settings.flush();
    const errors = settings.drainErrors();
    const written = settings.getGlobalSettings().packages ?? [];
    reapplyCompactionOverrides(settings, models, isLocal); // the save dropped the in-memory overrides
    const problem = errors[0]?.error.message ?? (JSON.stringify(written) === JSON.stringify(result.packages) ? undefined : "the saved list differs from the policy");
    if (problem) throw new Error(`managed policy: could not write packages: ${problem}`);
  }
  sync.record(result.managed);
}

/**
 * Pista's config owns the default model; Pi's settings.json copy is derived from it. Writes it (and saves) only
 * when it differs, so a hand-edited or stale value in Pi's file never wins. No Pista default leaves Pi's values alone.
 * The save rebuilds the in-memory view from the files, so call `reapplyCompactionOverrides` afterwards.
 */
export function syncDefaultModel(settings: SettingsManager, defaultModel: ModelRef | undefined): void {
  if (!defaultModel) return;
  if (settings.getDefaultProvider() === defaultModel.provider && settings.getDefaultModel() === defaultModel.id) return;
  settings.setDefaultModelAndProvider(defaultModel.provider, defaultModel.id);
}

/** Builds a Pi session with the given extensions; shared by thread loading and (later) child threads. */
export async function buildSession(opts: BuildSessionOptions): Promise<AgentSession> {
  const agentDir = piAgentDir();
  // One manager for the loader and the session, so both see the same trust state.
  const settingsManager = buildSettings(opts.cwd, agentDir, opts.models, opts.isLocal, opts.projectTrusted);
  // Before the loader reads settings, so a newly managed package loads in this very session.
  if (opts.packages) await applyManagedPackages(settingsManager, opts.packages, opts.models, opts.isLocal);
  const resourceLoader = new DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir,
    settingsManager,
    appendSystemPrompt: opts.appendSystemPrompt,
    additionalExtensionPaths: opts.additionalExtensionPaths ?? [],
    extensionFactories: opts.extensionFactories,
    ...(opts.skillAllowed
      ? { skillsOverride: ({ skills, diagnostics }: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => ({ skills: skills.filter((s) => opts.skillAllowed!(s.name)), diagnostics }) }
      : {}),
  });
  const managedSources = opts.packages?.rules?.packages?.length ?? 0;
  try {
    await resourceLoader.reload();
  } catch (error) {
    if (!managedSources) throw error;
    throw new Error(`managed policy: package install failed: ${(error as Error).message}`, { cause: error });
  }
  syncDefaultModel(settingsManager, opts.defaultModel);
  await settingsManager.flush();
  // reload() and the save above rebuild the settings from files, which drops the in-memory overrides buildSettings applied.
  reapplyCompactionOverrides(settingsManager, opts.models, opts.isLocal);

  const model = opts.model ? opts.models.getModel(opts.model.provider, opts.model.id) : undefined;
  const { session } = await createAgentSession({
    cwd: opts.cwd,
    agentDir,
    modelRuntime: opts.models,
    resourceLoader,
    settingsManager,
    ...(opts.sessionManager ? { sessionManager: opts.sessionManager } : {}),
    ...(opts.tools ? { tools: opts.tools } : {}),
    ...(model && (opts.sessionManager?.getEntryCount() ?? 0) === 0 ? { model } : {}),
  });
  // Covers restored sessions too, whose model Pi picks itself. Assigning the state avoids a model_change entry.
  // Pi's _refreshCurrentModelFromRegistry would replace this clone if an extension ever registers a provider through the session; re-apply capModel there if so.
  if (session.model) session.agent.state.model = capModel(session.model, { maxOutputTokens: opts.maxOutputTokens });
  return session;
}

/** Custom session entry types the host stores in a thread's session file. */
export const ENTRY = {
  /** `{ goal: GoalState | null }`; `null` records a clear. */
  goal: "pista.goal",
  plan: "pista.plan",
  /** One entry per decision: a `DecisionEntry`. */
  decision: "pista.decision",
  thinkingMode: "pista.thinking-mode",
} as const;

/** Latest custom entry of `kind` in the session, or undefined. */
export function readCustomEntry<T>(sessionManager: SessionManager, kind: string): T | undefined {
  const entries = sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as { type: string; customType?: string; data?: T };
    if (entry.type === "custom" && entry.customType === kind && entry.data != null) return entry.data;
  }
  return undefined;
}

/** Every custom entry of `kind`, oldest first. */
export function readCustomEntries<T>(sessionManager: SessionManager, kind: string): T[] {
  const out: T[] = [];
  for (const entry of sessionManager.getEntries() as { type: string; customType?: string; data?: T }[]) {
    if (entry.type === "custom" && entry.customType === kind && entry.data != null) out.push(entry.data);
  }
  return out;
}

export function writeCustomEntry(sessionManager: SessionManager, kind: string, data: unknown): void {
  sessionManager.appendCustomEntry(kind, data);
}
