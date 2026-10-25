import { create } from "zustand";
import { LOGIN_CANCELLED } from "@pista/protocol";
import { adoptPending } from "./pending.ts";
import type {
  AgentEvent,
  AssistantDelta,
  AuthPrompt,
  ChatMessage,
  ConfigPolicy,
  ConfigSource,
  DecisionEntry,
  GoalState,
  HostConfig,
  HostEvent,
  HostInfo,
  LlamaDownload,
  ModelInfo,
  Plan,
  Project,
  ProviderStatus,
  ThinkingMode,
  ThreadSnapshot,
  ThreadSummary,
  ToolCallBlock,
} from "@pista/protocol";
import { host } from "./host.ts";
import { downloadActive } from "./llama.ts";
import { browser, useBrowser } from "../browser/controller.ts";

const useBrowserFocused = () => useBrowser.getState().focusedId;

export interface ToolRun {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  partial?: unknown;
  result?: unknown;
}

export interface ThreadView extends Omit<ThreadSnapshot, "summary" | "decisions"> {
  /** The decision log, oldest first: from the snapshot, then appended by `decision_logged` events. */
  decisions: DecisionEntry[];
  toolRuns: Record<string, ToolRun>;
  turnStartedAt?: number;
  lastTurnMs?: number;
  retry?: string;
  /** Optimistic user messages (also in `messages`) still waiting for the host's echo. */
  pendingUser?: ChatMessage[];
  compacting?: boolean;
  /** Latest plan from the snapshot or `plan_updated` events; absent when the agent has none. */
  plan?: Plan;
  goal?: GoalState;
}

export interface Approval {
  approvalId: string;
  threadId: string;
  toolName: string;
  args: unknown;
  reason: string;
  /** Set when the host asks about one exact action (a held consequential browser action): shown as the card title, answered once, never "Always allow". */
  action?: string;
}

export interface Toast {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
}

/** An `auth.notice` event as the Providers tab keeps it. */
export type AuthNotice = Extract<HostEvent, { type: "auth.notice" }>;

export type PanelTabKind = "web" | "terminal" | "tools" | "changes" | "plan" | "decisions";
export interface PanelTab {
  id: string;
  kind: PanelTabKind;
}

const PINNED_KEY = "pista.pinned";
const LAYOUT_KEY = "pista.layout";

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 440;
const SIDEBAR_DEFAULT = 272;

function loadLayout(): { sidebarOpen: boolean; sidebarWidth: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}");
    return {
      sidebarOpen: saved.sidebarOpen ?? window.innerWidth >= 1000,
      sidebarWidth: Math.min(Math.max(saved.sidebarWidth ?? SIDEBAR_DEFAULT, SIDEBAR_MIN), SIDEBAR_MAX),
    };
  } catch {
    return { sidebarOpen: window.innerWidth >= 1000, sidebarWidth: SIDEBAR_DEFAULT };
  }
}

function saveLayout() {
  const { sidebarOpen, sidebarWidth } = useApp.getState();
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ sidebarOpen, sidebarWidth }));
  } catch {
    /* storage unavailable */
  }
}
function loadPinned(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PINNED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

interface AppState {
  connected: boolean;
  info?: HostInfo;
  /** Set when a request failed with `version_blocked:` before (or without) a structured gate; the message without its prefix. */
  versionBlockMessage: string | null;
  config?: HostConfig;
  /** Settings an organisation policy has locked; see `isLocked`. */
  policy: ConfigPolicy;
  /** Managed policy file in force, and where each setting's value comes from (shown in Settings). */
  policySource: string | null;
  configSources: Partial<Record<keyof HostConfig, ConfigSource>>;
  projects: Project[];
  threads: ThreadSummary[];
  views: Record<string, ThreadView>;
  activeThreadId: string | null;
  /** Project chosen for the next new thread (Codex creates the thread on first send). */
  draftProjectId: string | null;
  models: ModelInfo[];
  providers: ProviderStatus[];
  approvals: Approval[];
  authPrompt?: { promptId: string; provider: string; prompt: AuthPrompt };
  /** Latest sign-in notice per provider; cleared when a sign-in succeeds. */
  authNotices: Record<string, AuthNotice>;
  toasts: Toast[];
  panel: { open: boolean; tabs: PanelTab[]; activeId: string | null; chatWidth: number; maximized: boolean };
  sidebarOpen: boolean;
  sidebarWidth: number;
  pinned: string[];
  /** Threads that finished while not being viewed. */
  unread: Record<string, boolean>;
  nav: { stack: (string | null)[]; index: number };
  /** Browser page the user chose to reference in the next message. */
  pageContext: { url: string; title: string } | null;
  /** Thinking choice for a thread that doesn't exist yet. */
  draftThinkingMode: ThinkingMode;
  /** The first message of a thread that is still being created: shown in place of the empty state. */
  startingMessage: ChatMessage | null;
  settingsOpen: false | "general" | "providers" | "mcp" | "memory";
  /** Thread id whose goal dialog is open. */
  goalDialog: string | null;
  /** Per thread: how many decisions the user had seen when the Decisions tab was last open. */
  decisionsSeen: Record<string, number>;
  /** Decision id the Decisions tab should scroll to and expand, then clear. */
  decisionFocus: string | null;
  /** Built-in llama.cpp model downloads by spec. Lives here so progress survives closing Settings. */
  llamaDownloads: Record<string, LlamaDownload>;
}

export const useApp = create<AppState>(() => ({
  connected: false,
  versionBlockMessage: null,
  policy: { locked: [] },
  policySource: null,
  configSources: {},
  projects: [],
  threads: [],
  views: {},
  activeThreadId: null,
  draftProjectId: null,
  models: [],
  providers: [],
  authNotices: {},
  approvals: [],
  toasts: [],
  panel: { open: true, tabs: [], activeId: null, chatWidth: 520, maximized: false },
  ...loadLayout(),
  pinned: loadPinned(),
  unread: {},
  nav: { stack: [null], index: 0 },
  pageContext: null,
  draftThinkingMode: "auto",
  startingMessage: null,
  settingsOpen: false,
  goalDialog: null,
  decisionsSeen: {},
  decisionFocus: null,
  llamaDownloads: {},
}));

const set = useApp.setState;
const get = useApp.getState;

export function isLocked(key: keyof HostConfig): boolean {
  return get().policy.locked.includes(key);
}

let toastSeq = 0;
export function toast(message: string, level: Toast["level"] = "info") {
  const id = ++toastSeq;
  set((s) => ({ toasts: [...s.toasts, { id, level, message }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), level === "error" ? 8000 : 4000);
}

const setLlamaDownload = (d: LlamaDownload) => set((s) => ({ llamaDownloads: { ...s.llamaDownloads, [d.spec]: d } }));
const removeLlamaDownload = (spec: string) =>
  set((s) => {
    const { [spec]: _gone, ...rest } = s.llamaDownloads;
    return { llamaDownloads: rest };
  });

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const actions = {
  /** Shows the download at once ("starting"), then asks the host; a rejected request turns the chip into an error. */
  async startLlamaDownload(spec: string) {
    if (downloadActive(get().llamaDownloads[spec])) return;
    setLlamaDownload({ spec, bytes: 0, phase: "starting" });
    try {
      await host.call("llama.models.download", { spec });
    } catch (e) {
      const message = (e as Error).message;
      setLlamaDownload({ spec, bytes: 0, error: message, phase: "error" });
      toast(message, "error");
    }
  },
  dismissLlamaDownload: removeLlamaDownload,
  async bootstrap() {
    const info = await host.call("host.hello", { client: { nativeBrowser: Boolean(window.pistaDesktop?.browser) } });
    browser.baseUrl = info.config.homeUrl;
    if (!get().panel.tabs.some((t) => t.kind === "web")) actions.newWebTab(info.config.homeUrl);
    set({
      info,
      versionBlockMessage: null,
      config: info.config,
      policy: info.policy ?? { locked: [] },
      policySource: info.policySource ?? null,
      configSources: info.configSources ?? {},
      projects: info.projects,
      draftProjectId: get().draftProjectId ?? info.projects[0]?.id ?? null,
    });
    await Promise.all([actions.refreshThreads(), actions.refreshModels(), actions.refreshProviders()]);
    const active = get().activeThreadId;
    if (active) await actions.openThread(active);
  },

  async refreshThreads() {
    set({ threads: await host.call("threads.list", {}) });
  },
  async refreshModels() {
    set({ models: await host.call("models.list", {}) });
  },
  dismissAuthNotice(provider: string) {
    const { [provider]: _gone, ...rest } = get().authNotices;
    set({ authNotices: rest });
  },
  async cancelLogin(provider: string) {
    try {
      await host.call("auth.cancel", { provider });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  },
  async refreshProviders() {
    set({ providers: await host.call("auth.providers", {}) });
  },

  newThread(projectId?: string) {
    pushNav(null);
    set({ activeThreadId: null, draftProjectId: projectId ?? get().draftProjectId ?? get().projects[0]?.id ?? null });
  },

  async openThread(threadId: string, fromHistory = false) {
    if (!fromHistory) pushNav(threadId);
    set((s) => ({ activeThreadId: threadId, unread: { ...s.unread, [threadId]: false } }));
    const snapshot = await host.call("thread.open", { threadId });
    applySnapshot(snapshot);
  },

  async navigate(delta: -1 | 1) {
    const { stack, index } = get().nav;
    const next = index + delta;
    if (next < 0 || next >= stack.length) return;
    set({ nav: { stack, index: next } });
    const target = stack[next];
    if (target) await actions.openThread(target, true);
    else set({ activeThreadId: null });
  },

  setSidebar(open: boolean) {
    set({ sidebarOpen: open });
    saveLayout();
  },

  toggleSidebar() {
    actions.setSidebar(!get().sidebarOpen);
  },

  setSidebarWidth(width: number) {
    set({ sidebarWidth: Math.round(Math.min(Math.max(width, SIDEBAR_MIN), SIDEBAR_MAX)) });
    saveLayout();
  },

  togglePin(threadId: string) {
    const pinned = get().pinned.includes(threadId) ? get().pinned.filter((id) => id !== threadId) : [...get().pinned, threadId];
    set({ pinned });
    try {
      localStorage.setItem(PINNED_KEY, JSON.stringify(pinned));
    } catch {
      /* storage unavailable */
    }
  },

  async send(text: string, images?: { data: string; mimeType: string }[], delivery?: "steer" | "followUp") {
    // Show the message now; the host echoes it only after its pre-run steps. While a run is
    // streaming, the echo lands later in order, so queued messages are not shown optimistically.
    const imageBlocks = images?.map((i) => ({ type: "image" as const, ...i }));
    const optimistic: ChatMessage = {
      role: "user",
      content: imageBlocks?.length ? [{ type: "text", text }, ...imageBlocks] : text,
      timestamp: Date.now(),
    };
    let threadId = get().activeThreadId;
    let fresh = false;
    if (!threadId) {
      const projectId = get().draftProjectId ?? get().projects[0]?.id;
      if (!projectId) throw new Error("Add a project first");
      // No thread yet: App shows this instead of the empty state until the thread exists.
      set({ startingMessage: optimistic });
      try {
        const snapshot = await host.call("thread.create", { projectId });
        applySnapshot(snapshot);
        threadId = snapshot.summary.id;
        fresh = true;
        pushNav(threadId);
        // Same update as the switch, so the bubble never disappears in between.
        set({ activeThreadId: threadId, startingMessage: null });
        showOptimistic(threadId, optimistic);
      } catch (e) {
        set({ startingMessage: null });
        throw e;
      }
      const draft = get().draftThinkingMode;
      if (draft !== "auto") await actions.setThinking(draft);
      set({ draftThinkingMode: "auto" });
    }
    const before = get().views[threadId];
    const showNow = fresh || (!!before && !before.isStreaming && showOptimistic(threadId, optimistic));
    try {
      await host.call("thread.prompt", { threadId, text, images: imageBlocks, delivery });
    } catch (e) {
      const view = get().views[threadId];
      if (showNow && view?.pendingUser?.includes(optimistic)) {
        // The composer restores the text; take the bubble back out and the run state with it.
        patchView(threadId, {
          messages: view.messages.filter((m) => m !== optimistic),
          pendingUser: view.pendingUser.filter((m) => m !== optimistic),
          isStreaming: false,
          turnStartedAt: undefined,
        });
      }
      throw e;
    }
  },

  async abort() {
    const threadId = get().activeThreadId;
    if (threadId) await host.call("thread.abort", { threadId });
  },

  async setModel(provider: string, id: string) {
    const threadId = get().activeThreadId;
    if (threadId) {
      await host.call("thread.setModel", { threadId, model: { provider, id } });
      // The new model may support different thinking levels (local models: just off/on).
      applySnapshot(await host.call("thread.open", { threadId }));
    }
    if (!isLocked("defaultModel")) await actions.patchConfig({ defaultModel: { provider, id } });
  },

  /** Per-thread thinking override ("auto" is the default). Before the first message it applies to the new thread. */
  async setThinking(mode: ThinkingMode) {
    const threadId = get().activeThreadId;
    if (!threadId) {
      set({ draftThinkingMode: mode });
      return;
    }
    await host.call("thread.setThinking", { threadId, mode });
    patchView(threadId, { thinkingMode: mode, ...(mode !== "auto" ? { thinkingLevel: mode } : {}) });
  },

  async patchConfig(patch: Parameters<typeof host.call<"config.set">>[1]["patch"]) {
    const config = await host.call("config.set", { patch });
    set((s) => ({ config, configSources: { ...s.configSources, ...Object.fromEntries(Object.keys(patch).map((k) => [k, "user"])) } }));
    browser.baseUrl = config.homeUrl;
    return config;
  },

  async addProject(path: string) {
    const project = await host.call("projects.add", { path });
    set({ draftProjectId: project.id, activeThreadId: null });
    await actions.refreshThreads();
  },

  async setProjectTrusted(projectId: string, trusted: boolean) {
    // The host emits projects.changed, which updates the list.
    await host.call("projects.setTrusted", { projectId, trusted });
  },

  async removeProject(projectId: string) {
    await host.call("projects.remove", { projectId });
    // The host has already emitted projects.changed and thread.removed for each of its threads.
    const { draftProjectId, projects } = get();
    if (draftProjectId === projectId) set({ draftProjectId: projects[0]?.id ?? null });
  },

  async archive(threadId: string) {
    await host.call("thread.archive", { threadId });
    if (get().activeThreadId === threadId) set({ activeThreadId: null });
  },

  async rename(threadId: string, title: string) {
    await host.call("thread.rename", { threadId, title });
  },

  async setGoal(threadId: string, text: string, maxTurns?: number, maxTokens?: number, check?: string, replanEvery?: number) {
    patchView(threadId, { goal: await host.call("thread.goal.set", { threadId, text, maxTurns, maxTokens, check, replanEvery }) });
  },

  async pauseGoal(threadId: string) {
    patchView(threadId, { goal: await host.call("thread.goal.pause", { threadId }) });
  },

  async resumeGoal(threadId: string) {
    patchView(threadId, { goal: await host.call("thread.goal.resume", { threadId }) });
  },

  async clearGoal(threadId: string) {
    await host.call("thread.goal.clear", { threadId });
    patchView(threadId, { goal: undefined });
  },

  async respondApproval(approvalId: string, allow: boolean, always = false, note?: string) {
    set((s) => ({ approvals: s.approvals.filter((a) => a.approvalId !== approvalId) }));
    await host.call("approval.respond", { approvalId, allow, always, ...(note ? { note } : {}) });
  },

  /** Open (or focus) a singleton panel tab such as the terminal. */
  openPanelTab(kind: Exclude<PanelTabKind, "web">) {
    set((s) => ({
      panel: {
        ...s.panel,
        open: true,
        activeId: kind,
        tabs: s.panel.tabs.some((t) => t.id === kind) ? s.panel.tabs : [...s.panel.tabs, { id: kind, kind }],
      },
    }));
  },

  /** Open the Decisions tab, focused on the latest goal verdict or action of the thread. */
  showWhy(threadId: string) {
    const latest = [...(get().views[threadId]?.decisions ?? [])].reverse().find((d) => d.kind === "goal_verdict" || d.kind === "goal_action");
    useApp.setState({ decisionFocus: latest?.id ?? null });
    actions.openPanelTab("decisions");
  },

  newWebTab(url?: string): string {
    const id = browser.createTab(url);
    set((s) => ({ panel: { ...s.panel, open: true, activeId: id, tabs: [...s.panel.tabs, { id, kind: "web" }] } }));
    return id;
  },

  activatePanelTab(id: string) {
    const tab = get().panel.tabs.find((t) => t.id === id);
    if (tab?.kind === "web") browser.focus(id);
    set((s) => ({ panel: { ...s.panel, open: true, activeId: id } }));
  },

  closePanelTab(id: string) {
    const { tabs, activeId } = get().panel;
    const index = tabs.findIndex((t) => t.id === id);
    const rest = tabs.filter((t) => t.id !== id);
    if (tabs[index]?.kind === "web") browser.closeTab(id);
    const nextActive = activeId === id ? (rest[Math.max(0, index - 1)]?.id ?? null) : activeId;
    const next = rest.find((t) => t.id === nextActive);
    if (next?.kind === "web") browser.focus(next.id);
    set((s) => ({ panel: { ...s.panel, tabs: rest, activeId: nextActive, open: rest.length > 0 && s.panel.open } }));
  },

  togglePanel() {
    if (get().panel.tabs.length === 0) actions.newWebTab();
    else set((s) => ({ panel: { ...s.panel, open: !s.panel.open, maximized: false } }));
  },
};

browser.onNeedTab = (url) => actions.newWebTab(url);

function pushNav(threadId: string | null) {
  const { stack, index } = get().nav;
  if (stack[index] === threadId) return;
  set({ nav: { stack: [...stack.slice(0, index + 1), threadId].slice(-50), index: Math.min(index + 1, 49) } });
}

// ---------------------------------------------------------------------------
// Event reduction
// ---------------------------------------------------------------------------

function applySnapshot(snapshot: ThreadSnapshot) {
  const { summary, ...rest } = snapshot;
  set((s) => ({
    threads: upsert(s.threads, summary),
    views: {
      ...s.views,
      [summary.id]: { ...rest, decisions: rest.decisions ?? [], toolRuns: s.views[summary.id]?.toolRuns ?? {} },
    },
  }));
}

export function threadById(threads: ThreadSummary[], id: string | null | undefined): ThreadSummary | undefined {
  return id ? threads.find((t) => t.id === id) : undefined;
}

export function childrenOf(threads: ThreadSummary[], parentId: string): ThreadSummary[] {
  return threads.filter((t) => t.parentId === parentId);
}

function upsert(list: ThreadSummary[], thread: ThreadSummary): ThreadSummary[] {
  const next = list.filter((t) => t.id !== thread.id);
  next.push(thread);
  return next.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Appends an optimistic user message and marks the run as started. Returns false when the thread has no view. */
function showOptimistic(threadId: string, message: ChatMessage): boolean {
  const view = get().views[threadId];
  if (!view) return false;
  patchView(threadId, {
    messages: [...view.messages, message],
    pendingUser: [...(view.pendingUser ?? []), message],
    isStreaming: true,
    turnStartedAt: Date.now(),
  });
  return true;
}

function patchView(threadId: string, patch: Partial<ThreadView>) {
  set((s) => (s.views[threadId] ? { views: { ...s.views, [threadId]: { ...s.views[threadId], ...patch } } } : {}));
}

/** Narrow the open-ended `AgentEvent` union to one known event type. */
function isEvent<K extends "plan_updated" | "goal_updated" | "decision_logged">(event: AgentEvent, type: K): event is Extract<AgentEvent, { type: K }> {
  return event.type === type;
}

export function reduceThread(view: ThreadView, event: AgentEvent): ThreadView {
  switch (event.type) {
    case "agent_start":
      return { ...view, isStreaming: true, turnStartedAt: view.isStreaming ? view.turnStartedAt : Date.now(), retry: undefined };
    case "agent_settled":
      return {
        ...view,
        isStreaming: false,
        lastTurnMs: view.turnStartedAt ? Date.now() - view.turnStartedAt : undefined,
        retry: undefined,
        // A bubble that never got an echo stays visible; it is just no longer awaiting one.
        pendingUser: [],
      };
    case "message_start": {
      const message = structuredClone((event as { message: ChatMessage }).message);
      const adopted = adoptPending(view.messages, view.pendingUser ?? [], message);
      if (adopted) return { ...view, messages: adopted.messages, pendingUser: adopted.pending };
      return { ...view, messages: [...view.messages, message] };
    }
    case "message_update": {
      const e = event as { assistantMessageEvent: AssistantDelta; usage?: unknown };
      const messages = [...view.messages];
      const i = messages.length - 1;
      const last = messages[i];
      if (!last || last.role !== "assistant") return view;
      messages[i] = applyDelta(last, e.assistantMessageEvent);
      return { ...view, messages };
    }
    case "message_end": {
      const message = (event as { message: ChatMessage }).message;
      const messages = [...view.messages];
      const i = messages.length - 1;
      // The echo of an optimistic user message, unless message_start already adopted it
      // (the last message is then a non-pending user message).
      const lastIsAdopted = messages[i]?.role === message.role && !view.pendingUser?.includes(messages[i]);
      const adopted = lastIsAdopted ? undefined : adoptPending(messages, view.pendingUser ?? [], message);
      if (adopted) return { ...view, messages: adopted.messages, pendingUser: adopted.pending };
      if (messages[i]?.role === message.role) messages[i] = message;
      else messages.push(message);
      return { ...view, messages };
    }
    case "tool_execution_start": {
      const e = event as { toolCallId: string; toolName: string; args: Record<string, unknown> };
      return {
        ...view,
        toolRuns: { ...view.toolRuns, [e.toolCallId]: { id: e.toolCallId, name: e.toolName, args: e.args, status: "running" } },
      };
    }
    case "tool_execution_update": {
      const e = event as { toolCallId: string; partialResult: unknown };
      const run = view.toolRuns[e.toolCallId];
      return run ? { ...view, toolRuns: { ...view.toolRuns, [e.toolCallId]: { ...run, partial: e.partialResult } } } : view;
    }
    case "tool_execution_end": {
      const e = event as { toolCallId: string; result: unknown; isError: boolean };
      const run = view.toolRuns[e.toolCallId];
      return run
        ? { ...view, toolRuns: { ...view.toolRuns, [e.toolCallId]: { ...run, result: e.result, status: e.isError ? "error" : "done" } } }
        : view;
    }
    case "queue_update": {
      const e = event as { steering: string[]; followUp: string[] };
      return { ...view, queue: { steering: e.steering, followUp: e.followUp } };
    }
    case "auto_retry_start": {
      const e = event as { attempt: number; maxAttempts: number; errorMessage: string };
      return { ...view, retry: `Retrying (${e.attempt}/${e.maxAttempts}): ${e.errorMessage}` };
    }
    case "auto_retry_end":
      return { ...view, retry: undefined };
    case "compaction_start":
      return { ...view, compacting: true };
    case "compaction_end":
      return { ...view, compacting: false };
    case "plan_updated":
      return isEvent(event, "plan_updated") ? { ...view, plan: event.plan } : view;
    case "thinking_mode_changed":
      return { ...view, thinkingMode: (event as unknown as { mode: ThinkingMode }).mode };
    case "thinking_level_changed":
      return { ...view, thinkingLevel: (event as { level: ThreadView["thinkingLevel"] }).level };
    case "goal_updated":
      return isEvent(event, "goal_updated") ? { ...view, goal: event.goal ?? undefined } : view;
    case "decision_logged":
      return isEvent(event, "decision_logged") && !view.decisions.some((d) => d.id === event.decision.id)
        ? { ...view, decisions: [...view.decisions, event.decision] }
        : view;
    default:
      return view;
  }
}

type AssistantMessage = Extract<ChatMessage, { role: "assistant" }>;

function applyDelta(message: AssistantMessage, delta: AssistantDelta): AssistantMessage {
  const content = [...message.content];
  const idx = delta.contentIndex ?? content.length;
  const block = content[idx];
  switch (delta.type) {
    case "text_start":
      content[idx] = { type: "text", text: "" };
      break;
    case "text_delta":
      if (block?.type === "text") content[idx] = { ...block, text: block.text + (delta as { delta: string }).delta };
      else content[idx] = { type: "text", text: (delta as { delta: string }).delta };
      break;
    case "text_end":
      content[idx] = { type: "text", text: (delta as { content: string }).content };
      break;
    case "thinking_start":
      content[idx] = { type: "thinking", thinking: "" };
      break;
    case "thinking_delta":
      content[idx] = {
        type: "thinking",
        thinking: (block?.type === "thinking" ? block.thinking : "") + (delta as { delta: string }).delta,
      };
      break;
    case "thinking_end":
      content[idx] = { type: "thinking", thinking: (delta as { content: string }).content };
      break;
    case "toolcall_start": {
      const d = delta as { id: string; toolName: string };
      content[idx] = { type: "toolCall", id: d.id, name: d.toolName, arguments: {} };
      break;
    }
    case "toolcall_end":
      content[idx] = (delta as { toolCall: ToolCallBlock }).toolCall;
      break;
    default:
      return message;
  }
  return { ...message, content };
}

// ---------------------------------------------------------------------------
// Host event wiring
// ---------------------------------------------------------------------------

function onHostEvent(event: HostEvent) {
  switch (event.type) {
    case "thread.event": {
      const view = get().views[event.threadId];
      if (view) set((s) => ({ views: { ...s.views, [event.threadId]: reduceThread(view, event.event) } }));
      break;
    }
    case "thread.updated": {
      const prev = threadById(get().threads, event.thread.id);
      const finished = prev?.status === "running" && event.thread.status !== "running";
      set((s) => ({
        threads: upsert(s.threads, event.thread),
        unread: finished && s.activeThreadId !== event.thread.id ? { ...s.unread, [event.thread.id]: true } : s.unread,
      }));
      break;
    }
    case "thread.removed":
      set((s) => ({
        threads: s.threads.filter((t) => t.id !== event.threadId),
        activeThreadId: s.activeThreadId === event.threadId ? null : s.activeThreadId,
      }));
      break;
    case "approval.request":
      set((s) => ({ approvals: [...s.approvals, event] }));
      break;
    case "approval.resolved":
      set((s) => ({ approvals: s.approvals.filter((a) => a.approvalId !== event.approvalId) }));
      break;
    case "browser.request": {
      const focused = useBrowserFocused();
      if (focused) actions.activatePanelTab(focused);
      browser
        .handleAgentRequest(event.request)
        .then((result) => host.call("browser.respond", { requestId: event.requestId, ok: true, result }))
        .catch((error: Error) => host.call("browser.respond", { requestId: event.requestId, ok: false, error: error.message }));
      break;
    }
    case "auth.prompt":
      set({ authPrompt: event });
      break;
    case "auth.notice": {
      const { [event.provider]: _old, ...others } = get().authNotices;
      // A finished sign-in clears its notice; a failure keeps it so the tab can say why (a cancel stays quiet).
      const prompt = get().authPrompt;
      set({
        authNotices: event.done && (!event.error || event.error === LOGIN_CANCELLED) ? others : { ...others, [event.provider]: event },
        // A finished sign-in has no use for its manual-code dialog; close it so Cancel or a failure does not leave it open.
        ...(event.done && prompt?.provider === event.provider ? { authPrompt: undefined } : {}),
      });
      // The desktop shell opens the link in the system browser. A plain browser gets a button instead: a popup opened
      // here, outside a click, would be blocked, and a device code needs to stay visible next to its link anyway.
      if (event.url && !event.done) {
        if (window.pistaDesktop?.openExternal) window.pistaDesktop.openExternal(event.url);
        else if (event.kind !== "device_code") window.open(event.url, "_blank", "noopener");
      }
      if (event.done) void actions.refreshProviders().then(actions.refreshModels);
      break;
    }
    case "config.changed":
      set((s) => ({ config: event.config, configSources: event.configSources ?? s.configSources }));
      break;
    case "projects.changed":
      set({ projects: event.projects });
      break;
    case "toast":
      toast(event.message, event.level);
      break;
    case "llama.download": {
      const { type: _type, ...d } = event;
      setLlamaDownload(d);
      if (d.done) {
        void actions.refreshModels().catch(() => {});
        setTimeout(() => {
          if (get().llamaDownloads[d.spec]?.done) removeLlamaDownload(d.spec);
        }, 3000);
      }
      break;
    }
  }
}

export function startHostConnection() {
  host.on(onHostEvent);
  host.onStatus((connected) => {
    set({ connected });
    if (connected) actions.bootstrap().catch((e: Error) => toast(e.message, "error"));
  });
  host.connect();
}

host.onVersionBlocked((message) => useApp.setState({ versionBlockMessage: message }));
