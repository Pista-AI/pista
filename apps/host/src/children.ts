import {
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  type InlineExtension,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentRoleName, ModelRef, ThinkingMode, ThreadSummary } from "@pista/protocol";
import type { ConfigStore } from "./config.ts";
import { contextPruneExtension } from "./context-prune.ts";
import { browsingTurnsExtension } from "./browsing-turns.ts";
import { approvalExtension, browserExtension, loopGuardExtension, policyGateExtension, type ThreadRef } from "./extensions.ts";
import type { Hub } from "./hub.ts";
import type { RecordDecision } from "./decisions.ts";
import { planTool } from "./plan.ts";
import { resolveRoleModel } from "./model-tiers.ts";
import { availableRoles, isRestrictedRole, orchestratorGateExtension, orchestratorTools, ROLES, type RoleMap, roleGateExtension } from "./roles.ts";
import { modelRef } from "./models.ts";
import { stateExtension } from "./state.ts";
import { agentToolExtension, type ChildThreads } from "./subagent.ts";
import type { LiveThread } from "./threads.ts";
import { auditToolsExtension, type DecisionSource, observeBlocks, type ToolAudit } from "./audit-events.ts";

/** What decides a thread's tools and extensions: its role (children only) and whether it is a child at all. */
export interface ThreadKind {
  role: AgentRoleName | undefined;
  /** The role has a tool allowlist, or the thread is an orchestrator (`orchestratorTools`). */
  restricted: boolean;
  isChild: boolean;
  /** Tools of an orchestrator top-level thread (see `HostConfig.orchestratorMode`); absent otherwise. */
  orchestratorTools?: string[];
}

export interface ExtensionDeps {
  store: ConfigStore;
  hub: Hub;
  ref: ThreadRef;
  /** Backs the agent tool of top-level threads. */
  threads: ChildThreads;
  plan: Parameters<typeof planTool>[0];
  /** Logs decisions of the plan and agent tools to the thread's decision log. Optional because tools run in tests without a log, while `GoalHost.record` is required. */
  record?: RecordDecision;
  /** Tool names the user chose "Always allow" for in this thread. */
  alwaysAllowed?: Set<string>;
  /** The thread's thinking mode, read per request; without it browsing turns keep the thinking level they were given. */
  thinkingMode?: () => ThinkingMode | undefined;
  /** Roles of this thread's project (built-in plus files); defaults to the built-ins. */
  roles?: RoleMap;
  /** Tool audit for this thread; absent when the policy has no `audit` block. */
  toolAudit?: ToolAudit;
}

/** The extensions a thread gets, in load order. One rule per entry; see `ThreadKind`. */
export function extensionsFor(kind: ThreadKind, deps: ExtensionDeps): InlineExtension[] {
  const { role, restricted, isChild } = kind;
  const { store, hub, ref } = deps;
  const tools = deps.toolAudit;
  const watch = <T extends InlineExtension>(ext: T, source: DecisionSource): InlineExtension => (tools ? observeBlocks(ext, source, tools) : ext);
  return [
    // Restricted roles and orchestrators get no codemode, tool search, MCP or browser.
    ...(restricted
      ? []
      : [
          createCodemodeExtension({ mode: "on" }),
          createToolSearchExtension(),
          createMcpExtension(),
          ...(store.config.browserEnabled === false ? [] : [browserExtension(hub, ref, store.managedPolicy?.browser)]),
          browsingTurnsExtension({ config: store.config, thinkingMode: deps.thinkingMode ?? (() => undefined) }),
        ]),
    // Depth is 1: a child never gets the agent tool.
    ...(isChild ? [] : [agentToolExtension({ threads: deps.threads, ref, record: deps.record, verify: { store }, ...(deps.roles ? { roles: deps.roles } : {}) })]),
    // The gate runs before approvals so a tool the role can never use does not prompt the user.
    ...(role ? [watch(roleGateExtension(role, deps.roles), "policy")] : []),
    ...(kind.orchestratorTools ? [watch(orchestratorGateExtension(kind.orchestratorTools), "policy")] : []),
    watch(loopGuardExtension(store), "loop_guard"),
    stateExtension(),
    contextPruneExtension(store),
    // Children share the parent's cwd, so only role-less threads may write the plan file.
    ...(role ? [] : [planTool({ ...deps.plan, record: deps.record })]),
    watch(approvalExtension(hub, store, ref, deps.alwaysAllowed), "approval"),
    // Last, so it sees the input as every other extension left it and nothing runs after its block.
    ...(store.toolRules ? [policyGateExtension(store.toolRules, tools ? (name, input, denial, id) => tools.decision(id, name, input, "deny", { source: "policy", rule: denial.rule }) : undefined)] : []),
    // After every gate, so it only sees calls that were allowed.
    ...(tools ? [auditToolsExtension(tools)] : []),
  ];
}

/** What `Children` needs from the thread layer. */
export interface ChildrenHost {
  ensure(threadId: string): Promise<LiveThread>;
  load(projectId: string, sessionManager: SessionManager, model?: ModelRef): Promise<LiveThread>;
  /** Live or indexed summary of one thread. */
  summary(threadId: string): ThreadSummary | undefined;
  /** Summaries of every known thread, live and indexed. */
  summaries(): ThreadSummary[];
}

/** Parent/child bookkeeping and sub-agent thread creation. Children are ordinary threads with a role. */
export class Children {
  constructor(
    private store: ConfigStore,
    private host: ChildrenHost,
    /** Roles of a project's threads; defaults to the built-ins. */
    private rolesFor: (projectId: string) => RoleMap = () => ROLES,
  ) {}

  /** A child's parent: recorded in threadMeta before its first load, or taken from the session file's parent link. */
  parentOf(threadId: string): string | undefined {
    return this.store.getThreadMeta(threadId)?.parentId ?? this.host.summary(threadId)?.parentId;
  }

  /** Child by role or by parent link. Depth is 1, so a child never gets the agent tool. */
  isChildThread(threadId: string): boolean {
    return Boolean(this.store.getThreadMeta(threadId)?.role || this.parentOf(threadId));
  }

  /** Child threads keep their role across restarts: it is recorded in threadMeta before the first load. */
  kindOf(threadId: string, roles?: RoleMap): ThreadKind {
    const role = this.store.getThreadMeta(threadId)?.role;
    const isChild = this.isChildThread(threadId);
    const orchestrator = isChild ? undefined : orchestratorTools(this.store.config.orchestratorMode);
    return { role, restricted: orchestrator !== undefined || (role !== undefined && isRestrictedRole(role, roles)), isChild, ...(orchestrator ? { orchestratorTools: orchestrator } : {}) };
  }

  childIds(parentId: string): string[] {
    return [...new Set(this.host.summaries().filter((t) => t.parentId === parentId).map((t) => t.id))];
  }

  /**
   * Creates an idle child thread of `parentId` with the role's model and tools. Nothing is
   * prompted; the caller does that (see `prompt`, then `getLastAssistantText()` on the child).
   */
  async spawn(parentId: string, opts: { role: AgentRoleName }): Promise<string> {
    const parent = await this.host.ensure(parentId);
    const roles = this.rolesFor(parent.summary.projectId);
    if (typeof opts.role !== "string" || !availableRoles(roles).some((r) => r.name === opts.role)) throw new Error(`Unknown agent role: ${String(opts.role)}`);
    if (this.isChildThread(parentId)) throw new Error("Child threads cannot spawn children.");
    // The project path exactly as the parent uses it (no realpath), so Pi's session listing finds the child.
    const cwd = this.store.project(parent.summary.projectId).path;

    const parentFile = parent.summary.sessionFile ?? parent.session.sessionFile;
    const sessionManager = SessionManager.create(cwd, undefined, parentFile ? { parentSession: parentFile } : undefined);
    const id = sessionManager.getSessionId();
    this.store.setThreadMeta(id, { parentId, role: opts.role });
    try {
      const parentModel = modelRef(parent.session.model) ?? this.store.config.defaultModel;
      await this.host.load(parent.summary.projectId, sessionManager, resolveRoleModel(opts.role, this.store.config, parentModel, this.store.managedPolicy, roles));
    } catch (error) {
      this.store.deleteThreadMeta(id);
      throw error;
    }
    return id;
  }

  /** The live child thread, loading it from disk if needed, so it can be prompted again. */
  async continue(childId: string): Promise<LiveThread> {
    const thread = await this.host.ensure(childId);
    if (!this.isChildThread(childId)) throw new Error(`Not a child thread: ${childId}`);
    return thread;
  }
}
