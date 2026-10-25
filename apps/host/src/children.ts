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
import { isRestrictedRole, resolveRoleModel, ROLES, roleGateExtension } from "./roles.ts";
import { modelRef } from "./models.ts";
import { stateExtension } from "./state.ts";
import { agentToolExtension, type ChildThreads } from "./subagent.ts";
import type { LiveThread } from "./threads.ts";
import { auditToolsExtension, type DecisionSource, observeBlocks, type ToolAudit } from "./audit-events.ts";

/** What decides a thread's tools and extensions: its role (children only) and whether it is a child at all. */
export interface ThreadKind {
  role: AgentRoleName | undefined;
  /** The role has a tool allowlist. */
  restricted: boolean;
  isChild: boolean;
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
    // Restricted roles are read-only: no codemode, tool search, MCP or browser.
    ...(restricted
      ? []
      : [
          createCodemodeExtension({ mode: "on" }),
          createToolSearchExtension(),
          createMcpExtension(),
          browserExtension(hub, ref, store.managedPolicy?.browser),
          browsingTurnsExtension({ config: store.config, thinkingMode: deps.thinkingMode ?? (() => undefined) }),
        ]),
    // Depth is 1: a child never gets the agent tool.
    ...(isChild ? [] : [agentToolExtension({ threads: deps.threads, ref, record: deps.record })]),
    // The gate runs before approvals so a tool the role can never use does not prompt the user.
    ...(role ? [watch(roleGateExtension(role), "policy")] : []),
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
  kindOf(threadId: string): ThreadKind {
    const role = this.store.getThreadMeta(threadId)?.role;
    return { role, restricted: role !== undefined && isRestrictedRole(role), isChild: this.isChildThread(threadId) };
  }

  childIds(parentId: string): string[] {
    return [...new Set(this.host.summaries().filter((t) => t.parentId === parentId).map((t) => t.id))];
  }

  /**
   * Creates an idle child thread of `parentId` with the role's model and tools. Nothing is
   * prompted; the caller does that (see `prompt`, then `getLastAssistantText()` on the child).
   */
  async spawn(parentId: string, opts: { role: AgentRoleName }): Promise<string> {
    if (typeof opts.role !== "string" || !Object.hasOwn(ROLES, opts.role)) throw new Error(`Unknown agent role: ${String(opts.role)}`);
    const parent = await this.host.ensure(parentId);
    if (this.isChildThread(parentId)) throw new Error("Child threads cannot spawn children.");
    // The project path exactly as the parent uses it (no realpath), so Pi's session listing finds the child.
    const cwd = this.store.project(parent.summary.projectId).path;

    const parentFile = parent.summary.sessionFile ?? parent.session.sessionFile;
    const sessionManager = SessionManager.create(cwd, undefined, parentFile ? { parentSession: parentFile } : undefined);
    const id = sessionManager.getSessionId();
    this.store.setThreadMeta(id, { parentId, role: opts.role });
    try {
      const parentModel = modelRef(parent.session.model) ?? this.store.config.defaultModel;
      await this.host.load(parent.summary.projectId, sessionManager, resolveRoleModel(opts.role, this.store.config, parentModel, this.store.managedPolicy));
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
