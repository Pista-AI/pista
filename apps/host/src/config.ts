import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { ConfigPatch, ConfigPolicy, ConfigSource, HostConfig, ManagedPolicy, Project, ThreadSummary } from "@pista/protocol";
import { CLIENT_DIR, piAgentDir } from "./pi-env.ts";
import { convertLegacy, type LegacyServer, McpFile, validateServers } from "./mcp-config.ts";
import type { LoadedPolicy } from "./policy.ts";
import { mcpRules } from "./policy-access.ts";
import { compileToolRules, type ToolRules } from "./policy-tools.ts";
import { reconcileMcp } from "./policy-mcp.ts";

/** Client-owned state, and Pi's own state under `$PISTA_HOME/pi` (see pi-env.ts). */
export { CLIENT_DIR, piAgentDir };
const CONFIG_FILE = join(CLIENT_DIR, "config.json");
/** The scratch project created on first run; the only folder the host trusts without a `trusted` flag. */
export const WORKSPACE_DIR = join(CLIENT_DIR, "workspace");

export type ThreadMeta = Pick<ThreadSummary, "parentId" | "role">;

interface StoredState {
  /** `mcpServers` here is a view of Pi's mcp.json, refreshed on read and never saved to config.json. */
  config: HostConfig;
  projects: Project[];
  archivedThreads: string[];
  threadMeta: Record<string, ThreadMeta>;
  /** Stable per-installation UUID; ChatGPT sign-in registers it as the agent host. */
  deviceId: string;
  /** HostConfig keys the user changed through `config.set`; a managed policy's `defaults` never override these. */
  userSet: string[];
  /** Names of the MCP servers the managed policy installed in mcp.json on the last start, so a policy that drops one removes it. */
  managedMcp: string[];
  /** Pi package sources the managed policy put in settings.json on the last session build, so a policy that drops one removes it. */
  managedPackages: string[];
}


const DEFAULT_CONFIG: HostConfig = {
  mcpServers: [],
  homeUrl: process.env.PISTA_HOME_URL ?? "https://duckduckgo.com/",
  approvalMode: "ask-writes",
  defaultThinkingMode: "auto",
  instructions: "",
  linkTarget: "builtin",
  memoryEnabled: true,
  webSearchEnabled: true,
  localServers: [],
  llamaEnabled: false,
};

function projectId(path: string): string {
  return createHash("sha1").update(path).digest("hex").slice(0, 12);
}

export class ConfigStore {
  private state: StoredState;
  private mcp: McpFile;
  /** Settings an organisation policy has locked (see policy.ts). */
  policy: ConfigPolicy = { locked: [] };
  /** Where the managed policy came from, and what the loader complained about; for startup logging. */
  readonly policySource: string | null;
  /** The validated managed policy (allowlists, gateways); null when there is none. */
  readonly managedPolicy: ManagedPolicy | null;
  readonly policyWarnings: string[];
  /** Compiled `tools` section of the managed policy; null without one. */
  readonly toolRules: ToolRules | null;
  private lockedValues: Partial<HostConfig> = {};

  constructor(managed: LoadedPolicy = { policy: null, source: null, sourceKind: null, warnings: [] }) {
    this.policySource = managed.source;
    this.managedPolicy = managed.policy;
    this.policyWarnings = [...managed.warnings];
    const lockedValues = managed.policy?.locked ?? {};
    this.lockedValues = lockedValues;
    this.toolRules = compileToolRules(managed.policy);
    const { providers: p, models: m, mcp, tools } = managed.policy ?? {};
    this.policy = {
      locked: Object.keys(lockedValues) as Array<keyof HostConfig>,
      ...(p && (p.allow || p.disableDirectLogin) ? { providers: { ...(p.allow ? { allow: p.allow } : {}), ...(p.disableDirectLogin ? { disableDirectLogin: true } : {}) } } : {}),
      ...(m?.allow ? { models: { allow: m.allow } } : {}),
      ...(mcp ? { mcp: { managedServers: Object.keys(mcp.servers ?? {}), allowUserServers: mcp.allowUserServers !== false } } : {}),
      ...(managed.policy?.extensions ? { extensions: { managedPackages: managed.policy.extensions.packages ?? [], allowUserPackages: managed.policy.extensions.allowUserPackages !== false } } : {}),
      ...(tools ? { tools: { active: true } } : {}),
    };
    mkdirSync(CLIENT_DIR, { recursive: true });
    this.mcp = new McpFile();
    // Armed before the legacy migration below, so migrated servers obey the policy too.
    this.mcp.rules = mcpRules(managed.policy);
    const loaded = existsSync(CONFIG_FILE) ? (JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Partial<Omit<StoredState, "config">> & { config?: Partial<HostConfig> }) : {};
    // MCP servers used to live in config.json; move them into mcp.json once (servers already there win).
    const { mcpServers: legacy, ...storedConfig } = loaded.config ?? {};
    if (Array.isArray(legacy) && legacy.length) {
      const have = new Set(this.mcp.list().map((s) => s.name));
      const added = (legacy as unknown as LegacyServer[]).flatMap((s) => convertLegacy(s) ?? []).filter((s) => !have.has(s.name));
      for (const server of added) {
        try {
          this.mcp.set([...this.mcp.list(), server]);
        } catch (error) {
          this.policyWarnings.push(`mcp: legacy server "${server.name}" not migrated (${(error as Error).message})`);
        }
      }
    }
    // Older config.json files have no userSet: treat every key that differs from the built-in default as the user's.
    const userSet = Array.isArray(loaded.userSet) ? loaded.userSet : Object.entries(storedConfig).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(DEFAULT_CONFIG[key as keyof HostConfig])).map(([key]) => key);
    // Policy defaults sit between the built-in ones and the user's: they override everything the user never changed.
    const orgDefaults = Object.fromEntries(
      Object.entries(managed.policy?.defaults ?? {}).filter(([key]) => {
        const locked = key in lockedValues;
        if (locked) this.policyWarnings.push(`defaults.${key}: also locked, default ignored`);
        return !locked && !userSet.includes(key);
      }),
    );
    this.state = {
      userSet,
      config: { ...DEFAULT_CONFIG, ...storedConfig, ...orgDefaults },
      projects: loaded.projects ?? [],
      archivedThreads: loaded.archivedThreads ?? [],
      threadMeta: loaded.threadMeta ?? {},
      deviceId: loaded.deviceId ?? randomUUID(),
      managedMcp: Array.isArray(loaded.managedMcp) ? loaded.managedMcp.filter((n): n is string => typeof n === "string") : [],
      managedPackages: Array.isArray(loaded.managedPackages) ? loaded.managedPackages.filter((n): n is string => typeof n === "string") : [],
    };
    this.applyMcpPolicy(managed);
    if (this.state.projects.length === 0) {
      // A scratch workspace so the app is usable before any folder is added.
      mkdirSync(WORKSPACE_DIR, { recursive: true });
      this.state.projects.push({ id: projectId(WORKSPACE_DIR), name: "Workspace", path: WORKSPACE_DIR });
    }
    this.save();
  }

  /** Installs the policy's MCP servers in mcp.json and removes blocked and no-longer-managed ones. Without an `mcp` section and without earlier managed servers nothing is touched.
   * When the policy could not be trusted (failed to load, malformed `mcp` section) the file and the managed list are left as they are. */
  private applyMcpPolicy(managed: LoadedPolicy): void {
    const policy = managed.policy;
    if (managed.mcpUntrusted) {
      if (this.state.managedMcp.length > 0 || policy?.mcp) this.policyWarnings.push("mcp: the policy could not be read in full, mcp.json left as it is");
      return;
    }
    if (!policy?.mcp && this.state.managedMcp.length === 0) return;
    try {
      const result = reconcileMcp(this.mcp.entries(), policy?.mcp, this.state.managedMcp);
      if (result.changed) this.mcp.replaceEntries(result.servers);
      this.state.managedMcp = result.managed;
    } catch (error) {
      this.policyWarnings.push(`mcp: could not apply to mcp.json (${(error as Error).message})`);
    }
  }

  /** What a session build needs to apply the policy's `extensions` section to Pi's settings (see `syncManagedPackages`). */
  packageSync(): { rules: ManagedPolicy["extensions"]; previous: string[]; record(managed: string[]): void } {
    return {
      rules: this.managedPolicy?.extensions,
      previous: [...this.state.managedPackages],
      record: (managed) => {
        if (JSON.stringify(managed) === JSON.stringify(this.state.managedPackages)) return;
        this.state.managedPackages = managed;
        this.save();
      },
    };
  }

  get config(): HostConfig {
    // mcp.json may have been edited by hand, so the server list is re-read on every access.
    this.state.config.mcpServers = this.mcp.list();
    if (Object.keys(this.lockedValues).length === 0) return this.state.config;
    // Locked values win over whatever is stored and are never saved: save() writes state.config, not this overlay.
    // Cloned so a caller mutating the result cannot change the policy.
    return { ...this.state.config, ...structuredClone(this.lockedValues) };
  }

  get deviceId(): string {
    return this.state.deviceId;
  }

  get projects(): Project[] {
    return this.state.projects.map((p) => (p.path === WORKSPACE_DIR ? { ...p, trusted: true, trustFixed: true } : p));
  }

  isArchived(threadId: string): boolean {
    return this.state.archivedThreads.includes(threadId);
  }

  archive(threadId: string): void {
    if (!this.isArchived(threadId)) this.state.archivedThreads.push(threadId);
    this.save();
  }

  getThreadMeta(threadId: string): ThreadMeta | undefined {
    return this.state.threadMeta[threadId];
  }

  setThreadMeta(threadId: string, meta: ThreadMeta): void {
    this.state.threadMeta[threadId] = meta;
    this.save();
  }

  deleteThreadMeta(threadId: string): void {
    delete this.state.threadMeta[threadId];
    this.save();
  }

  /** Where each setting's value comes from: locked by policy, an org default, the user's own, or the built-in default. */
  sources(): Partial<Record<keyof HostConfig, ConfigSource>> {
    const defaults = this.managedPolicy?.defaults ?? {};
    return Object.fromEntries(
      (Object.keys(DEFAULT_CONFIG) as Array<keyof HostConfig>).map((key) => [key, key in this.lockedValues ? "locked" : this.state.userSet.includes(key) ? "user" : key in defaults ? "policy" : "default"]),
    );
  }

  /** Throws, naming the keys, when a client patch touches a locked setting. Call before `patchConfig`; nothing is written.
   * The dedicated handlers (llama, local servers, model switch) call it too, before any side effect.
   * A `patchConfig` that skips it may persist a locked key to disk, but `config` always shows the locked value. */
  assertUnlocked(patch: ConfigPatch): void {
    const hit = this.policy.locked.filter((key) => key in patch);
    if (hit.length > 0) throw new Error(`Managed by your organisation, cannot be changed: ${hit.join(", ")}`);
  }

  /** `userSet: true` is for the `config.set` RPC: it records the patched keys as the user's own, so policy defaults leave them alone. */
  patchConfig(patch: ConfigPatch, opts: { userSet?: boolean } = {}): HostConfig {
    const { maxOutputTokens, mcpServers, ...rest } = patch;
    if (mcpServers !== undefined) {
      const problem = validateServers(mcpServers);
      if (problem) throw new Error(problem);
    }
    const next = { ...this.state.config, ...rest };
    if ("maxOutputTokens" in patch) {
      // Only a positive integer sets the cap; null, undefined or anything else clears it.
      if (Number.isSafeInteger(maxOutputTokens) && (maxOutputTokens as number) > 0) next.maxOutputTokens = maxOutputTokens as number;
      else delete next.maxOutputTokens;
    }
    if (mcpServers !== undefined) this.mcp.set(mcpServers);
    this.state.config = next;
    if (opts.userSet) for (const key of Object.keys(patch)) if (!this.state.userSet.includes(key)) this.state.userSet.push(key);
    this.save();
    return this.config;
  }

  addProject(path: string, name?: string): Project {
    const abs = resolve(path.replace(/^~(?=$|\/)/, homedir()));
    if (!existsSync(abs)) throw new Error(`Folder does not exist: ${abs}`);
    const existing = this.state.projects.find((p) => p.path === abs);
    if (existing) return existing;
    const project = { id: projectId(abs), name: name || basename(abs), path: abs };
    this.state.projects.push(project);
    this.save();
    return project;
  }

  /**
   * Marks a project folder trusted or untrusted. Live sessions keep the trust they were built with until they are
   * rebuilt (the caller reloads idle ones); Pi resources are not hot-reloaded. The default workspace cannot be changed.
   */
  setProjectTrusted(id: string, trusted: boolean): Project {
    const project = this.project(id);
    if (project.path === WORKSPACE_DIR) throw new Error("The default workspace is always trusted");
    if (trusted) project.trusted = true;
    else delete project.trusted;
    this.save();
    return project;
  }

  removeProject(id: string): void {
    this.state.projects = this.state.projects.filter((p) => p.id !== id);
    this.save();
  }

  project(id: string): Project {
    const project = this.state.projects.find((p) => p.id === id);
    if (!project) throw new Error(`Unknown project: ${id}`);
    return project;
  }

  private save(): void {
    const { mcpServers: _inMcpJson, ...config } = this.state.config;
    writeFileSync(CONFIG_FILE, JSON.stringify({ ...this.state, config }, null, 2), { mode: 0o600 });
  }
}
