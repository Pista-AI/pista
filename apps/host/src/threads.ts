import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type AgentSession,
  type AgentSessionEvent,
  type ModelRuntime,
  SessionManager,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentEvent,
  AgentRoleName,
  ChatMessage,
  GoalState,
  ImageBlock,
  ModelRef,
  Plan,
  ThinkingLevel,
  ThinkingMode,
  ThreadSnapshot,
  ThreadSummary,
} from "@pista/protocol";
import { type AuditSink, auditHash, noopAudit } from "./audit.ts";
import { emitPrompt, emitUsage, scopeAudit, ToolAudit } from "./audit-events.ts";
import { AgentRoles } from "./role-files.ts";
import { CLIENT_DIR, type ConfigStore, WORKSPACE_DIR } from "./config.ts";
import { DecisionLog } from "./decisions.ts";
import { Children, extensionsFor } from "./children.ts";
import { systemPrompt, type ThreadRef } from "./extensions.ts";
import "./memory.ts";
import { type CheckOutcome, GoalRunner, type GoalJudge, leadingText, runUsage, transcriptTail } from "./goal-runner.ts";
import { CHECK_TIMEOUT_MS, judgeGoal, resolveJudgeModel, type SettleKind } from "./goal.ts";
import { bundledExtensionPaths } from "./packages.ts";
import { resolveProjectTrust } from "./project-trust.ts";
import { capModel, modelRef, usableModel } from "./models.ts";
import { buildSession, ENTRY, readCustomEntry, reapplyCompactionOverrides, writeCustomEntry } from "./session.ts";
import { clip, type TextContent } from "./text.ts";
import { DEFAULT_MAX_TOOL_CALLS, orchestratorPrompt, READ_ONLY_TOOLS, roleOf, rolePrompt, validToolCallLimit } from "./roles.ts";
import { describeDenied, isModelAllowed, pickAllowedModel, restrictsModels } from "./policy-access.ts";
import { isLocalProvider } from "./local.ts";
import { deleteFile } from "./retention.ts";
import { autoLevel, fallbackNeedsThinking, judgeNeedsThinking, recentHistory } from "./thinking.ts";

import type { Hub } from "./hub.ts";

/** Pi's model object (it carries more than the provider and id, e.g. baseUrl). */
type PiModel = NonNullable<AgentSession["model"]>;

/** Per-run counters that stop agents stuck repeating a failing call (see onEvent). */
interface RunGuard {
  lastError: string;
  streak: number;
  toolCalls: number;
  stopped: boolean;
}

// Pi rejects calls with invalid arguments before extension hooks run, so the
// loop-guard extension can't see them; these limits catch such loops here.
const MAX_SAME_ERROR_STREAK = 4;

export interface LiveThread {
  /** Tool audit; absent when the policy has no `audit` block. */
  toolAudit?: ToolAudit;
  guard: RunGuard;
  /** Tool calls one run may make before the guard stops it: the role's `maxToolCalls` for a sub-agent, `HostConfig.maxToolCalls` for a top-level thread, else 60. */
  maxToolCalls: number;
  /** "auto" decides per user message; otherwise the pinned level. */
  thinkingMode: ThinkingMode;
  /** Whether Auto chose thinking for the previous user message (context for the fallback). */
  lastTurnThought: boolean;
  plan?: Plan;
  decisions: DecisionLog;
  /** Tools the user chose "Always allow" for (shared with the approval extension). */
  alwaysAllowed: Set<string>;
  session: AgentSession;
  summary: ThreadSummary;
  unsubscribe: () => void;
  /** Set when Pi's overflow recovery failed; keeps the thread in error when the run then settles. */
  compactionError?: string;
  queue: { steering: string[]; followUp: string[] };
  /** Index into session.messages where the current run began (for token accounting). */
  runStart: number;
}

const TITLE_MAX = 64;

function titleFrom(text: TextContent): string {
  return clip(text, TITLE_MAX) || "New thread";
}

/** Strip SDK-only cumulative snapshots so events match Pi's JSON/RPC wire shape. */
function toWire(event: AgentSessionEvent): AgentEvent {
  const e = event as unknown as Record<string, unknown> & { type: string };
  switch (e.type) {
    case "message_update": {
      const { partial, ...delta } = e.assistantMessageEvent as Record<string, unknown> & {
        partial?: { content?: { id?: string; name?: string }[] };
      };
      if (delta.type === "toolcall_start" && partial?.content) {
        const block = partial.content[delta.contentIndex as number];
        delta.id = block?.id;
        delta.toolName = block?.name;
      }
      const message = e.message as { usage?: unknown } | undefined;
      return { type: "message_update", usage: message?.usage, assistantMessageEvent: delta } as AgentEvent;
    }
    case "agent_end":
      return { type: "agent_end", willRetry: e.willRetry as boolean };
    case "turn_end":
      return { type: "turn_end" };
    default:
      return e as AgentEvent;
  }
}

export class ThreadManager {
  private live = new Map<string, LiveThread>();
  /** threadId → summary for persisted sessions not yet loaded. */
  private index = new Map<string, ThreadSummary>();

  constructor(
    private store: ConfigStore,
    private hub: Hub,
    private models: ModelRuntime,
    /** Called before a prompt runs, e.g. to load a local model with enough context. */
    private prepareModel: (provider: string, modelId: string) => Promise<void> = async () => {},
    goalJudge?: GoalJudge,
    /** Audit export; the no-op sink when the policy has no `audit` block. */
    readonly audit: AuditSink = noopAudit,
  ) {
    this.goals = new GoalRunner(
      {
        isStreaming: (id) => this.live.get(id)?.session.isStreaming ?? false,
        hasQueued: (id) => {
          const q = this.live.get(id)?.queue;
          return !!q && q.steering.length + q.followUp.length > 0;
        },
        prompt: async (id, text, isStale) => {
          // A rejection is already toasted and pauses the goal in send.
          (await this.send(id, text, undefined, "steer", isStale)).run.catch(() => {});
        },
        transcriptTail: (id) => transcriptTail((this.live.get(id)?.session.messages ?? []) as ChatMessage[]),
        persist: (id, goal) => {
          const live = this.live.get(id);
          if (live) writeCustomEntry(live.session.sessionManager, ENTRY.goal, { goal });
        },
        emit: (id, goal) => this.emitEvent(id, { type: "goal_updated", goal }),
        record: (id, entry) => void this.live.get(id)?.decisions.record(entry),
        turnInfo: (id, sinceTs) => {
          const live = this.live.get(id);
          return {
            rationale: leadingText((live?.session.messages ?? []) as ChatMessage[]) || undefined,
            planChanges: (live?.decisions.list() ?? []).filter((d) => d.kind === "plan_change" && d.ts >= sinceTs).map((d) => d.summary),
          };
        },
      },
      goalJudge ?? ((goal, tail, id) => this.judgeGoal(goal, tail, id)),
      (id, command, isStale) => this.runGoalCheck(id, command, isStale),
    );
    this.agentRoles = new AgentRoles({
      userDir: join(CLIENT_DIR, "agents"),
      isTrusted: (path) => resolveProjectTrust(path, this.store.projects, WORKSPACE_DIR).trusted,
      overrides: () => this.store.config.agentOverrides,
    });
    this.children = new Children(
      store,
      {
        ensure: (id) => this.ensure(id),
        load: (projectId, sessionManager, model) => this.load(projectId, sessionManager, model),
        summary: (id) => this.live.get(id)?.summary ?? this.index.get(id),
        summaries: () => this.summaries(),
      },
      (projectId) => this.agentRoles.forProject(this.store.project(projectId).path),
    );
  }

  private agentRoles: AgentRoles;

  private goals: GoalRunner;
  private children: Children;

  /** The thread's own model judges, like the thinking judge; the default model if it has none. */
  private async judgeGoal(goal: GoalState, tail: string, threadId: string) {
    // The thread's model is allowed by construction; the default is only used when it has none, so check it.
    const threadModel = this.live.get(threadId)?.session.model;
    const fallback = threadModel ? undefined : await this.allowedStartModel(this.store.config.defaultModel).catch(() => undefined);
    const ref = resolveJudgeModel(threadModel, fallback);
    if (!ref) return { tokens: 0 };
    return judgeGoal(this.models, ref, goal, tail);
  }

  // -- Listing ---------------------------------------------------------------

  async list(): Promise<ThreadSummary[]> {
    for (const project of this.store.projects) {
      let infos: SessionInfo[] = [];
      try {
        infos = await SessionManager.list(project.path);
      } catch {
        continue;
      }
      const idByPath = new Map(infos.map((i) => [i.path, i.id]));
      for (const info of infos) {
        if (this.live.has(info.id) || this.store.isArchived(info.id)) continue;
        const parentId = info.parentSessionPath ? idByPath.get(info.parentSessionPath) : undefined;
        this.index.set(info.id, {
          id: info.id,
          projectId: project.id,
          title: info.name || titleFrom(info.firstMessage),
          sessionFile: info.path,
          createdAt: info.created.getTime(),
          updatedAt: info.modified.getTime(),
          messageCount: info.messageCount,
          status: "idle",
          loaded: false,
          ...(parentId ? { parentId } : {}),
          ...this.store.getThreadMeta(info.id),
        });
      }
    }
    return this.summaries()
      .filter((t) => !this.store.isArchived(t.id))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Every known thread once: loaded threads win over their stale index entries. */
  private summaries(): ThreadSummary[] {
    const all = [...this.index.values(), ...[...this.live.values()].map((t) => t.summary)];
    return [...new Map(all.map((t) => [t.id, t])).values()];
  }

  // -- Lifecycle ---------------------------------------------------------------

  async create(projectId: string, role?: string): Promise<ThreadSnapshot> {
    const project = this.store.project(projectId);
    const sessionManager = SessionManager.create(project.path);
    if (role === undefined) return this.snapshot(await this.load(projectId, sessionManager));
    const roles = this.agentRoles.forProject(project.path);
    if (typeof role !== "string" || !Object.hasOwn(roles, role) || roles[role]!.disabled) throw new Error(`Unknown agent role: ${String(role)}`);
    if (roles[role]!.standalone && this.store.config.browserEnabled === false) throw new Error("The invoice job needs the browser. Turn it on under Settings.");
    // Recorded before the first load, like a child's role; `parentId` stays unset, so the thread is still top-level.
    const id = sessionManager.getSessionId();
    this.store.setThreadMeta(id, { role });
    try {
      return this.snapshot(await this.load(projectId, sessionManager));
    } catch (error) {
      this.store.deleteThreadMeta(id);
      throw error;
    }
  }

  async open(threadId: string): Promise<ThreadSnapshot> {
    return this.snapshot(await this.ensure(threadId));
  }

  private async ensure(threadId: string): Promise<LiveThread> {
    const live = this.live.get(threadId);
    if (live) return live;
    const summary = this.index.get(threadId);
    if (!summary?.sessionFile) throw new Error(`Unknown thread: ${threadId}`);
    return this.load(summary.projectId, SessionManager.open(summary.sessionFile));
  }

  private async load(projectId: string, sessionManager: SessionManager, model?: ModelRef): Promise<LiveThread> {
    const project = this.store.project(projectId);
    const ref: ThreadRef = { threadId: sessionManager.getSessionId() };
    // The plan tool is registered before the LiveThread exists; it only runs after `thread` is assigned.
    let thread: LiveThread | undefined;
    const decisions = new DecisionLog(sessionManager, (decision) => this.emitEvent(ref.threadId, { type: "decision_logged", decision }));
    decisions.restore();
    const alwaysAllowed = new Set<string>();
    const roles = this.agentRoles.forProject(project.path);
    const kind = this.children.kindOf(ref.threadId, roles);
    const { role, restricted } = kind;
    const cwd = role ? sessionManager.getCwd() : project.path;
    const trust = resolveProjectTrust(cwd, this.store.projects, WORKSPACE_DIR);
    const audit = scopeAudit(this.audit, () => ({ "session.id": ref.threadId, "project.id": projectId }));
    const toolAudit = this.audit === noopAudit ? undefined : new ToolAudit(audit);
    this.auditTrust(projectId, trust.trusted, trust.reason, trust.reason === "project marked trusted" ? "user" : "default", false, audit);
    if (!trust.trusted && existsSync(join(cwd, ".pi"))) console.info(`[pista-host] ${cwd}: skipped .pi/ (project untrusted: ${trust.reason})`);
    const startModel = await this.allowedStartModel(model ?? this.store.config.defaultModel);
    // `extensionsFor` adds the shared runner.
    const harnessHost = {
      cwd,
      config: <T,>() => this.store.config.sliced as T | undefined,
      windowCap: () => this.store.config.contextWindowCap,
      readOnlyTools: READ_ONLY_TOOLS,
      state: { read: <T,>(entryKind: string) => readCustomEntry<T>(sessionManager, entryKind) },
    };
    const harnessPrompt = kind.harness?.prompt?.(harnessHost);
    const session = await buildSession({
      cwd,
      projectTrusted: trust.trusted,
      models: this.models,
      model: startModel,
      // Only an allowed default is written to Pi's settings, so Pi never falls back to a disallowed model.
      ...(this.store.config.defaultModel && isModelAllowed(this.store.managedPolicy, this.store.config.defaultModel) ? { defaultModel: this.store.config.defaultModel } : {}),
      ...(this.store.config.maxOutputTokens !== undefined ? { maxOutputTokens: this.store.config.maxOutputTokens } : {}),
      isLocal: (m) => this.scalesCompaction(m as PiModel),
      packages: this.store.packageSync(),
      ...(this.store.toolRules ? { skillAllowed: (name: string) => this.store.toolRules!.skillAllowed(name) } : {}),
      sessionManager,
      // The orchestrator allowlist is only ever set for top-level threads, so it takes precedence over any role.
      ...(kind.orchestratorTools ? { tools: kind.orchestratorTools } : role && roleOf(role, roles).tools.length ? { tools: roleOf(role, roles).tools } : {}),
      appendSystemPrompt: [systemPrompt(this.store), ...(role ? [rolePrompt(role, roles)] : []), ...(kind.orchestratorMode && !kind.harness ? [orchestratorPrompt(kind.orchestratorMode)] : []), ...(harnessPrompt ? [harnessPrompt] : [])],
      additionalExtensionPaths: restricted ? [] : bundledExtensionPaths(this.store.config),
      extensionFactories: extensionsFor(kind, {
        store: this.store,
        hub: this.hub,
        ref,
        threads: this,
        plan: { getPlan: () => thread?.plan, setPlan: (plan) => thread && this.setPlan(thread, plan) },
        record: (entry) => void decisions.record(entry),
        alwaysAllowed,
        cwd: sessionManager.getCwd(),
        harness: harnessHost,
        roles,
        thinkingMode: () => thread?.thinkingMode,
        ...(toolAudit ? { toolAudit } : {}),
      }),
    });
    // A restored session keeps the model Pi saved with it; move it off one the policy has since disallowed.
    const restored = modelRef(session.model);
    if (restored && restrictsModels(this.store.managedPolicy) && !isModelAllowed(this.store.managedPolicy, restored)) {
      try {
        const fallback = await this.allowedStartModel(undefined);
        const replacement = fallback && this.models.getModel(fallback.provider, fallback.id);
        if (!replacement) throw new Error(describeDenied(restored));
        await session.setModel(capModel(replacement, this.store.config));
      } catch (error) {
        // Fail closed: never leave a live session on a model the policy disallows.
        try {
          session.dispose();
        } catch {}
        throw error;
      }
    }
    const defaults = this.store.config;
    // Emits session_start: MCP servers connect in the background.
    await session.bindExtensions({});

    const now = Date.now();
    const firstUser = session.messages.find((m) => m.role === "user") as Extract<ChatMessage, { role: "user" }> | undefined;
    thread = {
      guard: { lastError: "", streak: 0, toolCalls: 0, stopped: false },
      maxToolCalls: (role ? roleOf(role, roles).maxToolCalls : validToolCallLimit(defaults.maxToolCalls)) ?? DEFAULT_MAX_TOOL_CALLS,
      thinkingMode: readCustomEntry<{ mode?: ThinkingMode }>(sessionManager, ENTRY.thinkingMode)?.mode ?? (role ? roleOf(role, roles).thinking : undefined) ?? defaults.defaultThinkingMode ?? "auto",
      lastTurnThought: false,
      plan: readCustomEntry<Plan>(sessionManager, ENTRY.plan),
      decisions,
      alwaysAllowed,
      ...(toolAudit ? { toolAudit } : {}),
      session,
      queue: { steering: [], followUp: [] },
      runStart: session.messages.length,
      unsubscribe: () => {},
      summary: {
        id: session.sessionId,
        projectId,
        title: session.sessionName || (firstUser ? titleFrom(firstUser.content) : "New thread"),
        sessionFile: session.sessionFile,
        createdAt: this.index.get(session.sessionId)?.createdAt ?? now,
        updatedAt: this.index.get(session.sessionId)?.updatedAt ?? now,
        messageCount: session.messages.length,
        status: "idle",
        loaded: true,
        ...this.store.getThreadMeta(session.sessionId),
      },
    };
    ref.threadId = thread.summary.id;
    thread.unsubscribe = session.subscribe((event) => this.onEvent(thread, event));
    this.live.set(thread.summary.id, thread);
    this.index.delete(thread.summary.id);
    this.hub.emit({ type: "thread.updated", thread: thread.summary });
    this.audit.emit("pista.session.start", { "session.id": thread.summary.id, "project.id": projectId, "cwd.hash": auditHash(cwd), "session.restored": !!thread.summary.sessionFile && session.messages.length > 0 });
    this.goals.restore(thread.summary.id, readCustomEntry<{ goal: GoalState | null }>(sessionManager, ENTRY.goal)?.goal);
    return thread;
  }

  /**
   * The model a new session starts on. With an allowlist in the managed policy, a disallowed
   * preference falls back to the first allowed available model; throws when none is usable.
   */
  private async allowedStartModel(preferred: ModelRef | undefined): Promise<ModelRef | undefined> {
    const policy = this.store.managedPolicy;
    if (!restrictsModels(policy) || (preferred && isModelAllowed(policy, preferred))) return preferred;
    const refs = (list: readonly { provider: string; id: string }[]) => list.map((m) => ({ provider: m.provider, id: m.id }));
    const picked = pickAllowedModel(policy, refs(await this.models.getAvailable()), preferred, refs(this.models.getModels()));
    if (preferred && picked) console.log(`[pista-host] model ${preferred.provider}/${preferred.id} is not allowed by policy, using ${picked.provider}/${picked.id}`);
    return picked;
  }

  /** Stores the plan in the session, so it survives restarts, and tells the UI. */
  private setPlan(thread: LiveThread, plan: Plan): void {
    thread.plan = plan;
    writeCustomEntry(thread.session.sessionManager, ENTRY.plan, plan);
    this.emitEvent(thread.summary.id, { type: "plan_updated", plan });
  }

  /** How the run that just settled ended, from what the host observed. */
  private settleKind(thread: LiveThread): SettleKind {
    if (thread.guard.stopped) return "guard_stopped";
    // Only this run's messages: an assistant message from an earlier run says nothing about it.
    const run = thread.session.messages.slice(thread.runStart);
    const last = [...run].reverse().find((m) => m.role === "assistant") as ChatMessage | undefined;
    const reason = last?.role === "assistant" ? last.stopReason : undefined;
    return reason === "aborted" ? "aborted" : reason === "error" ? "error" : "completed";
  }

  private onEvent(thread: LiveThread, event: AgentSessionEvent): void {
    const { summary } = thread;
    switch (event.type) {
      case "agent_start":
        thread.runStart = thread.session.messages.length;
        thread.compactionError = undefined;
        this.touch(thread, { status: "running" });
        break;
      case "tool_execution_start":
        thread.toolAudit?.start(event as { toolCallId: string; toolName: string; args?: unknown });
        break;
      case "tool_execution_end":
        thread.toolAudit?.end(event as { toolCallId: string; isError?: boolean });
        this.guardRun(thread, event as { toolName: string; isError: boolean; result?: { content?: { type: string; text?: string }[] } });
        break;
      case "agent_settled":
        this.touch(thread, { status: thread.compactionError ? "error" : "idle", messageCount: thread.session.messages.length, sessionFile: thread.session.sessionFile });
        this.warmJudge(thread);
        const usage = runUsage(thread.session.messages as ChatMessage[], thread.runStart);
        emitUsage(scopeAudit(this.audit, () => ({ "session.id": summary.id, "project.id": summary.projectId })), thread.session.messages as ChatMessage[], thread.runStart);
        void this.goals
          .onSettle(summary.id, this.settleKind(thread), usage.billed, usage.cacheRead)
          .catch((e: Error) => console.warn(`[goal] settle failed: ${e.message}`));
        break;
      case "message_end": {
        const message = event.message as ChatMessage;
        if (message.role === "assistant" && message.stopReason === "error") this.touch(thread, { status: "error" });
        break;
      }
      case "compaction_end":
        // Pi also fires the extension event session_compact_failed for this; the session
        // listener only sees compaction_end, so this is the one place to catch it.
        if (event.errorMessage && !event.aborted) {
          // An overflow failure ends the run, so the settle that follows must not report idle.
          // Threshold failures are overwritten by agent_settled and manual ones would stick, so only overflow sets error.
          if (event.reason === "overflow") {
            thread.compactionError = event.errorMessage;
            this.touch(thread, { status: "error" });
          }
          this.hub.emit({ type: "toast", level: "error", message: `Context compaction failed in "${summary.title}": ${event.errorMessage}` });
        }
        break;
      case "queue_update":
        thread.queue = { steering: [...event.steering], followUp: [...event.followUp] };
        break;
      case "session_info_changed":
        if (event.name) this.touch(thread, { title: event.name });
        break;
    }
    this.emitEvent(summary.id, toWire(event));
  }

  /** Sends a session event to the UI. */
  private emitEvent(threadId: string, event: AgentEvent): void {
    this.hub.emit({ type: "thread.event", threadId, event });
  }

  /** Local models, and every model while a `contextWindowCap` is set, get compaction thresholds scaled to their window. */
  private scalesCompaction(model: PiModel): boolean {
    return this.store.config.contextWindowCap !== undefined || this.isLocal(model);
  }

  private isLocal(model: PiModel): boolean {
    return isLocalProvider(model.provider, model.baseUrl, this.store.config);
  }

  /**
   * LM Studio pays a one-off delay (1-5s, sometimes more) on the first small request after a
   * large agent request, while switching prompt caches. Sending a throwaway judge request as
   * soon as a reply finishes moves that cost to when the user is reading, so the real judge
   * on the next message answers in ~0.2s.
   */
  private warmJudge(thread: LiveThread) {
    const model = usableModel(thread.session.model);
    if (!model || thread.thinkingMode !== "auto" || !this.isLocal(model)) return;
    if ((thread.session.getAvailableThinkingLevels() as ThinkingLevel[]).length <= 1) return;
    // Load first (with our context size) so a warm-up never makes the server load it with defaults.
    void this.prepareModel(model.provider, model.id)
      .then(() => judgeNeedsThinking(this.models, model, "", "ok", 60_000))
      .catch(() => {});
  }

  private async decideThinking(thread: LiveThread, model: PiModel, text: string) {
    const { session } = thread;
    const levels = session.getAvailableThinkingLevels() as ThinkingLevel[];
    if (levels.length <= 1) return; // the model can't switch thinking
    const local = this.isLocal(model);
    const started = Date.now();
    let think: boolean;
    let by: string;
    if (!local) {
      think = true; // adaptive cloud models decide how much to think themselves
      by = "adaptive model";
    } else {
      try {
        think = await judgeNeedsThinking(this.models, model, recentHistory(session.messages), text);
        by = "model judge";
      } catch (error) {
        think = fallbackNeedsThinking(text, thread.lastTurnThought);
        by = `fallback rule (${(error as Error).message})`;
      }
    }
    thread.lastTurnThought = think;
    const level = autoLevel(levels, think);
    if (level && level !== session.thinkingLevel) session.setThinkingLevel(level);
    console.debug(`[auto-thinking] ${think ? "think" : "no thinking"} via ${by} in ${Date.now() - started}ms: ${text.slice(0, 60)}`);
  }

  private guardRun(thread: LiveThread, event: { toolName: string; isError: boolean; result?: { content?: { type: string; text?: string }[] } }) {
    const guard = thread.guard;
    if (guard.stopped) return;
    guard.toolCalls++;
    if (event.isError) {
      const text = event.result?.content?.find((c) => c.type === "text")?.text ?? "";
      const key = `${event.toolName}:${text.slice(0, 160)}`;
      guard.streak = key === guard.lastError ? guard.streak + 1 : 1;
      guard.lastError = key;
    } else {
      guard.streak = 0;
    }
    const reason =
      guard.streak >= MAX_SAME_ERROR_STREAK
        ? `the agent called ${event.toolName} ${guard.streak} times in a row with the same error`
        : guard.toolCalls >= thread.maxToolCalls
          ? `the run reached ${thread.maxToolCalls} tool calls`
          : undefined;
    if (!reason) return;
    guard.stopped = true;
    void thread.session.abort();
    this.hub.emit({
      type: "toast",
      level: "warn",
      message: `Stopped "${thread.summary.title}": ${reason}. Smaller models get stuck like this; try a larger model or rephrase.`,
    });
  }

  private touch(thread: LiveThread, patch: Partial<ThreadSummary>): void {
    thread.summary = { ...thread.summary, ...patch, updatedAt: Date.now() };
    this.hub.emit({ type: "thread.updated", thread: thread.summary });
  }

  snapshot(thread: LiveThread): ThreadSnapshot {
    const { session, summary } = thread;
    const activeTools = new Set(session.getActiveToolNames());
    return {
      summary: thread.summary,
      messages: session.messages.filter((m) => m.role !== "system") as ChatMessage[],
      model: modelRef(session.model),
      thinkingLevel: session.thinkingLevel as ThinkingLevel,
      thinkingMode: thread.thinkingMode,
      ...(thread.plan ? { plan: thread.plan } : {}),
      availableThinkingLevels: session.getAvailableThinkingLevels() as ThinkingLevel[],
      isStreaming: session.isStreaming,
      queue: thread.queue,
      tools: session.getAllTools().map((t) => ({
        name: t.name,
        description: t.description,
        active: activeTools.has(t.name),
        namespace: t.namespace?.name,
        exposure: t.exposure,
      })),
      contextUsage: session.getContextUsage(),
      goal: this.goals.get(summary.id),
      decisions: thread.decisions.list(),
    };
  }

  // -- Commands ---------------------------------------------------------------

  /** A user message: also invalidates any in-flight goal judgement or continuation. */
  async prompt(threadId: string, text: string, images: ImageBlock[] | undefined, delivery: "steer" | "followUp" = "steer") {
    // Progress streams through events; failures are reported by the toast in send.
    (await this.startPrompt(threadId, text, images, delivery)).run.catch(() => {});
  }

  /**
   * Like `prompt`, but also returns the run: it resolves when the run settles and rejects with the
   * error Pi threw (also toasted). Callers that wait for a run, such as the agent tool, need this
   * because a run that fails to start emits no `agent_settled`.
   */
  async startPrompt(threadId: string, text: string, images: ImageBlock[] | undefined, delivery: "steer" | "followUp" = "steer"): Promise<{ run: Promise<void> }> {
    this.goals.noteUserPrompt(threadId);
    return this.send(threadId, text, images, delivery);
  }

  /** Shared by user prompts and goal continuations so RunGuard, thinking and prepareModel apply to both. */
  private async send(
    threadId: string,
    text: string,
    images: ImageBlock[] | undefined,
    delivery: "steer" | "followUp" = "steer",
    /** Goal continuations only: checked right before the prompt reaches the session. */
    isStale?: () => boolean,
  ): Promise<{ run: Promise<void> }> {
    const thread = await this.ensure(threadId);
    const { session } = thread;
    if (!session.sessionName && !session.messages.some((m) => m.role === "user")) {
      const title = titleFrom(text);
      session.setSessionName(title);
      this.touch(thread, { title });
    }
    let model = usableModel(session.model);
    if (!model) throw new Error("No model is available. Sign in to a provider in Settings → Providers.");
    if (!session.isStreaming) {
      // A new user message starts a fresh run; steering messages keep the current counters.
      thread.guard = { lastError: "", streak: 0, toolCalls: 0, stopped: false };
      this.touch(thread, { status: "running" });
      await this.prepareModel(model.provider, model.id).catch((error: Error) => {
        this.touch(thread, { status: "idle" });
        throw error;
      });
      model = (await this.refreshModel(thread)) ?? model;
      // Auto thinking: decided once per user message, kept for the whole turn (tool follow-ups).
      if (thread.thinkingMode === "auto") await this.decideThinking(thread, model, text);
    }
    // The awaits above leave a window in which the user may have prompted, paused or replaced the goal.
    if (isStale?.()) {
      if (!session.isStreaming) this.touch(thread, { status: "idle" });
      return { run: Promise.resolve() };
    }
    emitPrompt(scopeAudit(this.audit, () => ({ "session.id": threadId, "project.id": thread.summary.projectId })), text, session.isStreaming);
    // session.prompt() resolves when the run settles.
    const run = session
      .prompt(text, { images, streamingBehavior: session.isStreaming ? delivery : undefined })
      .catch((error: Error) => {
        this.touch(thread, { status: "error" });
        this.hub.emit({ type: "toast", level: "error", message: error.message });
        // No agent_settled follows a rejected prompt, so a running goal would otherwise hang.
        this.goals.pauseIfRunning(threadId, error.message);
        // The UI marks the thread as running as soon as the user sends, so tell it the run is over.
        // A rejected steering message leaves the current run going, which settles on its own.
        if (!session.isStreaming) this.emitEvent(threadId, { type: "agent_settled" });
        throw error;
      });
    return { run };
  }

  async abort(threadId: string) {
    const live = this.live.get(threadId);
    // Also covers a stop during the judge call or prepareModel, when nothing is streaming.
    this.goals.pauseIfRunning(threadId, "Stopped by the user");
    await live?.session.abort();
  }

  /**
   * Runs a goal's check command through the same shell as the agent's bash tool (`session.executeBash`).
   * That path skips the tool_call gate, so the approval mode is applied here: read-only skips the check,
   * ask-writes asks once per run. Throws when the command could not run to completion, which includes a command the policy refuses (the goal pauses with the reason).
   */
  private async runGoalCheck(threadId: string, command: string, isStale: () => boolean = () => false): Promise<CheckOutcome> {
    const live = this.live.get(threadId);
    if (!live) throw new Error("Thread is not loaded");
    // executeBash skips the tool_call gate, so the policy's shell rules are applied here, before anything is asked or run.
    const denied = this.shellDenial(command);
    if (denied) throw new Error(denied);
    const mode = this.store.config.approvalMode;
    if (mode === "read-only") return { skipped: "Read-only mode blocks running commands, so the acceptance check was not run." };
    if (mode !== "full-access" && !live.alwaysAllowed.has("bash")) {
      const answer = await this.hub.ask<{ allow: boolean; always?: boolean; note?: string }>(
        (approvalId) => ({
          type: "approval.request",
          approvalId,
          threadId,
          toolName: "bash",
          args: { command },
          reason: "acceptance check for the goal",
        }),
        10 * 60_000,
      );
      if (answer.always) live.alwaysAllowed.add("bash");
      if (!answer.allow) {
        const note = answer.note?.trim();
        throw new Error(`The user declined to run the acceptance check${note ? `: ${note}` : ""}`);
      }
    }
    // The approval can take minutes; the goal may have been paused, cleared or replaced meanwhile.
    if (isStale()) return { skipped: "check skipped: goal changed while awaiting approval" };
    const started = Date.now();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // The SDK has no handle for one execution, so this aborts every running bash. That is acceptable here:
      // the check runs at settle, after the agent turn ended and before the next continuation starts.
      live.session.abortBash();
    }, CHECK_TIMEOUT_MS);
    try {
      const result = await live.session.executeBash(command, undefined, { excludeFromContext: true });
      if (timedOut) throw new Error(`Timed out after ${CHECK_TIMEOUT_MS / 1000} s: ${command}`);
      if (result.exitCode === undefined) throw new Error(`Cancelled before it finished: ${command}`);
      return { exitCode: result.exitCode, output: result.output, durationMs: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }

  // -- Goals -------------------------------------------------------------------

  async goalSet(threadId: string, text: string, opts: { maxTurns?: number; maxTokens?: number; check?: string; replanEvery?: number }) {
    await this.ensure(threadId);
    return this.goals.set(threadId, text, opts);
  }

  async goalPause(threadId: string) {
    await this.ensure(threadId);
    return this.goals.pause(threadId);
  }

  async goalResume(threadId: string) {
    await this.ensure(threadId);
    return this.goals.resume(threadId);
  }

  async goalClear(threadId: string) {
    await this.ensure(threadId);
    this.goals.clear(threadId);
    return { ok: true } as const;
  }

  async rename(threadId: string, title: string) {
    const thread = await this.ensure(threadId);
    thread.session.setSessionName(title);
    this.touch(thread, { title });
  }

  private trustSeen = new Map<string, boolean>();
  /** Records a project's trust decision when it changed since last recorded (or `force`, for the user toggle). */
  auditTrust(projectId: string, trusted: boolean, reason: string, source: "user" | "default", force: boolean, sink: AuditSink = this.audit): void {
    if (!force && this.trustSeen.get(projectId) === trusted) return;
    this.trustSeen.set(projectId, trusted);
    sink.emit("pista.project.trust", { "project.id": projectId, trusted, "trust.reason": reason, "trust.source": source });
  }

  /** Disposes a live session and records its end in the audit stream. */
  private endLive(thread: LiveThread, reason: string) {
    thread.unsubscribe();
    thread.session.dispose();
    thread.toolAudit?.clear();
    this.audit.emit("pista.session.end", { "session.id": thread.summary.id, "project.id": thread.summary.projectId, "session.end.reason": reason, "session.message_count": thread.summary.messageCount });
  }

  async archive(threadId: string) {
    await this.list(); // refresh the index so unloaded children are found
    this.archiveTree(threadId, new Set());
  }

  /** The synchronous part of archive: no awaits, so a caller can check and archive in one step. */
  private archiveTree(threadId: string, visited: Set<string>) {
    if (visited.has(threadId)) return; // inconsistent threadMeta must not recurse forever
    visited.add(threadId);
    for (const child of this.children.childIds(threadId)) this.archiveTree(child, visited);
    const live = this.live.get(threadId);
    if (live) {
      this.endLive(live, "archived");
      this.live.delete(threadId);
    }
    this.goals.drop(threadId);
    this.index.delete(threadId);
    this.store.archive(threadId);
    this.store.deleteThreadMeta(threadId);
    this.hub.emit({ type: "thread.removed", threadId });
  }

  /**
   * Takes a project out of the sidebar. Non-destructive: session files and the folder stay on disk, so
   * adding the same path again brings its threads back. Archived threads stay archived.
   */
  async removeProject(projectId: string) {
    this.store.project(projectId); // unknown project: throw before touching anything
    const ids = this.summaries().filter((t) => t.projectId === projectId).map((t) => t.id);
    for (const id of ids) {
      const live = this.live.get(id);
      if (live) {
        this.goals.pauseIfRunning(id, "Project removed");
        await live.session.abort().catch(() => {});
        this.endLive(live, "project_removed");
        this.live.delete(id);
      }
      this.goals.drop(id);
      this.index.delete(id);
      this.store.deleteThreadMeta(id);
      this.hub.emit({ type: "thread.removed", threadId: id });
    }
    this.store.removeProject(projectId);
    this.hub.emit({ type: "projects.changed", projects: this.store.projects });
  }

  // -- Child threads -------------------------------------------------------------

  spawnChild(parentId: string, opts: { role: AgentRoleName }): Promise<string> {
    return this.children.spawn(parentId, opts);
  }

  continueChild(childId: string): Promise<LiveThread> {
    return this.children.continue(childId);
  }

  /** Pi saves settings on setModel, which drops the in-memory compaction overrides; put them back. */
  private reapplyCompaction(thread: LiveThread): void {
    reapplyCompactionOverrides(thread.session.settingsManager, this.models, (m) => this.scalesCompaction(m as PiModel));
  }

  /**
   * Pi does not watch the model registry, so a provider re-registered after the session started
   * (a local server reporting its real context window) leaves the session on a stale model object.
   * Swap in the fresh one when the limits changed. Returns it, or undefined when nothing changed.
   */
  private async refreshModel(thread: LiveThread): Promise<PiModel | undefined> {
    const current = thread.session.model;
    if (!current) return undefined;
    try {
      const registered = this.models.getModel(current.provider, current.id);
      if (!registered || registered === current) return undefined;
      const fresh = capModel(registered, this.store.config);
      const same =
        fresh.contextWindow === current.contextWindow &&
        fresh.maxTokens === current.maxTokens &&
        fresh.baseUrl === current.baseUrl && // a managed local server gets a new port when it restarts
        JSON.stringify(fresh.thinkingLevelMap ?? null) === JSON.stringify(current.thinkingLevelMap ?? null);
      if (same) return undefined;
      await thread.session.setModel(fresh);
      this.reapplyCompaction(thread);
      return fresh;
    } catch {
      return undefined;
    }
  }

  async setModel(threadId: string, ref: ModelRef) {
    this.store.assertUnlocked({ defaultModel: ref });
    if (!isModelAllowed(this.store.managedPolicy, ref)) throw new Error(describeDenied(ref));
    const thread = await this.ensure(threadId);
    const model = this.models.getModel(ref.provider, ref.id);
    if (!model) throw new Error(`Unknown model ${ref.provider}/${ref.id}`);
    await thread.session.setModel(capModel(model, this.store.config));
    this.reapplyCompaction(thread);
    this.store.patchConfig({ defaultModel: ref }, { userSet: true });
    this.warmJudge(thread);
  }

  /** Per-thread override; "auto" returns the decision to the client. Stored in the session. */
  async setThinking(threadId: string, mode: ThinkingMode) {
    const thread = await this.ensure(threadId);
    thread.thinkingMode = mode;
    writeCustomEntry(thread.session.sessionManager, ENTRY.thinkingMode, { mode });
    if (mode !== "auto") thread.session.setThinkingLevel(mode);
    this.emitEvent(threadId, { type: "thinking_mode_changed", mode });
  }

  async compact(threadId: string) {
    await (await this.ensure(threadId)).session.compact();
  }

  /** The policy's refusal text for running `command` in a shell, or undefined. Used where the host runs a shell itself (executeBash skips the tool_call gate). */
  private shellDenial(command: string): string | undefined {
    const rules = this.store.toolRules;
    return (rules?.checkTool("bash") ?? rules?.checkBash(command))?.reason;
  }

  async bash(threadId: string, command: string) {
    const { session } = await this.ensure(threadId);
    const denied = this.shellDenial(command);
    if (denied) throw new Error(denied);
    const result = await session.executeBash(command);
    return { output: result.output, exitCode: result.exitCode };
  }

  mcpTools(threadId?: string) {
    const thread = threadId ? this.live.get(threadId) : this.live.values().next().value;
    if (!thread) return [];
    // Pi writes "-" as "_" in tool namespaces; show the name the server has in mcp.json.
    const configured = new Map(this.store.config.mcpServers.map((s) => [s.name.replace(/-/g, "_"), s.name]));
    const servers = new Map<string, { name: string; toolCount: number; exposure?: string }>();
    for (const tool of thread.session.getAllTools()) {
      const ns = tool.namespace?.name;
      if (!ns?.startsWith("mcp__")) continue;
      const name = configured.get(ns.slice(5)) ?? ns.slice(5);
      const entry = servers.get(name) ?? { name, toolCount: 0, exposure: tool.exposure };
      entry.toolCount++;
      servers.set(name, entry);
    }
    return [...servers.values()];
  }

  /**
   * Retention purge: archives (same code as a user delete) every idle thread tree last active before `cutoff`, then
   * removes its session files. Live (open) or running threads, and trees containing one, are kept. The index is
   * refreshed once; each tree is then checked and archived with no await in between, so a thread the user opens
   * meanwhile is seen as live and kept, and a tree that gained a child is checked as it is now.
   */
  async purgeThreads(cutoff: number, sessionsDir: string, stats: { threads: number; skipped: number }): Promise<void> {
    await this.list();
    const roots = this.summaries().filter((t, _i, all) => !t.parentId || !all.some((p) => p.id === t.parentId));
    for (const root of roots) {
      if (this.store.isArchived(root.id)) continue;
      const byId = new Map(this.summaries().map((s) => [s.id, s]));
      const tree: ThreadSummary[] = [];
      const walk = (id: string) => {
        const node = byId.get(id);
        if (!node || tree.includes(node)) return;
        tree.push(node);
        for (const child of this.children.childIds(id)) walk(child);
      };
      walk(root.id);
      if (tree.some((n) => n.updatedAt >= cutoff || n.status === "running" || this.live.has(n.id) || this.goals.get(n.id)?.status === "running")) continue;
      this.archiveTree(root.id, new Set());
      stats.threads += tree.length;
      for (const n of tree) if (n.sessionFile && !deleteFile(n.sessionFile, sessionsDir)) stats.skipped++;
    }
  }

  /**
   * Recreate idle live sessions so config changes (MCP endpoint, instructions, project trust) take effect.
   * With `projectId`, only that project's threads are dropped.
   */
  async reloadIdle(projectId?: string) {
    for (const [id, thread] of this.live) {
      if (projectId && thread.summary.projectId !== projectId) continue;
      if (thread.session.isStreaming || this.goals.get(id)?.status === "running") continue;
      // Children of a running parent stay loaded: the parent's agent tool is waiting on them.
      const parentId = this.children.parentOf(id);
      if (parentId && this.live.get(parentId)?.session.isStreaming) continue;
      // A child that was never prompted has no session file, so dropping it would lose it.
      if (parentId && thread.summary.messageCount === 0) continue;
      this.endLive(thread, "reloaded");
      this.live.delete(id);
      if (thread.summary.sessionFile && thread.summary.messageCount > 0) this.index.set(id, { ...thread.summary, loaded: false });
      else this.hub.emit({ type: "thread.removed", threadId: id });
    }
  }

  dispose() {
    for (const thread of this.live.values()) this.endLive(thread, "shutdown");
  }
}
