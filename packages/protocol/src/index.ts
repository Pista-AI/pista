/**
 * Wire protocol between the Pista UI and the agent host.
 *
 * The host is a Node sidecar that embeds the Pi agent (SDK). The UI talks to it
 * over a single WebSocket using JSON frames. The same protocol works in a plain
 * browser (dev), inside Electron (renderer ↔ sidecar) and inside Tauri 2
 * (webview ↔ sidecar), which keeps the UI shell-agnostic.
 *
 * Frames:
 *   UI → host   { kind: "req", id, method, params }
 *   host → UI   { kind: "res", id, ok, result | error }
 *   host → UI   { kind: "evt", event }
 */

// ---------------------------------------------------------------------------
// Transcript values (a structural subset of Pi's AgentMessage union, kept
// local so the UI never depends on agent packages).
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: "text";
  text: string;
}
export interface ImageBlock {
  type: "image";
  data: string;
  mimeType: string;
}
export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  redacted?: boolean;
}
export interface ToolCallBlock {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: { total: number };
}

export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

export type ChatMessage =
  | { role: "user"; content: string | (TextBlock | ImageBlock)[]; timestamp: number }
  | {
      role: "assistant";
      content: (TextBlock | ThinkingBlock | ToolCallBlock)[];
      provider: string;
      model: string;
      usage?: Usage;
      stopReason: StopReason;
      errorMessage?: string;
      timestamp: number;
    }
  | {
      role: "toolResult";
      toolCallId: string;
      toolName: string;
      content: (TextBlock | ImageBlock)[];
      details?: unknown;
      isError: boolean;
      timestamp: number;
    }
  | {
      role: "bashExecution";
      command: string;
      output: string;
      exitCode: number | undefined;
      cancelled: boolean;
      timestamp: number;
    }
  | { role: "custom"; customType: string; content: string | (TextBlock | ImageBlock)[]; display: boolean; timestamp: number }
  | { role: "compactionSummary"; summary: string; tokensBefore: number; timestamp: number }
  | { role: "branchSummary"; summary: string; timestamp: number };

/** Session events forwarded from Pi (JSON-mode shape: message_update is delta-only). */
export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; willRetry?: boolean }
  | { type: "agent_settled" }
  | { type: "turn_start" }
  | { type: "turn_end" }
  | { type: "message_start"; message: ChatMessage }
  | { type: "message_update"; usage?: Usage; assistantMessageEvent: AssistantDelta }
  | { type: "message_end"; message: ChatMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; partialResult: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: "queue_update"; steering: string[]; followUp: string[] }
  | { type: "compaction_start"; reason: string }
  | { type: "compaction_end"; reason: string; aborted: boolean; errorMessage?: string }
  | { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
  | { type: "session_info_changed"; name?: string }
  | { type: "thinking_level_changed"; level: string }
  | { type: "plan_updated"; plan: Plan }
  /** `goal` is null when the thread's goal was cleared. */
  | { type: "goal_updated"; goal: GoalState | null }
  | { type: "decision_logged"; decision: DecisionEntry }
  | { type: string; [key: string]: unknown };

export type AssistantDelta =
  | { type: "text_start"; contentIndex: number }
  | { type: "text_delta"; contentIndex: number; delta: string }
  | { type: "text_end"; contentIndex: number; content: string }
  | { type: "thinking_start"; contentIndex: number }
  | { type: "thinking_delta"; contentIndex: number; delta: string }
  | { type: "thinking_end"; contentIndex: number; content: string }
  | { type: "toolcall_start"; contentIndex: number; id: string; toolName: string }
  | { type: "toolcall_delta"; contentIndex: number; delta: string }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCallBlock }
  | { type: string; contentIndex?: number; [key: string]: unknown };

// ---------------------------------------------------------------------------
// Domain objects
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  path: string;
  /**
   * Whether Pi may load this folder's project-level resources: `.pi/` (settings, mcp.json, extensions, skills,
   * prompts, packages, SYSTEM.md, APPEND_SYSTEM.md) and `.agents/skills` in it and its ancestors.
   * Absent means untrusted. Stored in config.json; set with `projects.setTrusted`.
   */
  trusted?: boolean;
  /** Set on the default workspace, which is always trusted and cannot be changed. */
  trustFixed?: boolean;
}

export type ThreadStatus = "idle" | "running" | "error";

/** Built-in sub-agent roles; custom roles come from markdown files (`$PISTA_HOME/agents`, `<project>/.pista/agents`). */
export type BuiltinAgentRoleName = "explorer" | "implementer" | "reviewer";
export type AgentRoleName = string;

/** A sub-agent role: its default model, tool allowlist (empty = everything the parent has) and a short description. Files can only narrow tools. */
export interface AgentRole {
  name: AgentRoleName;
  model?: ModelSpec;
  tools: string[];
  /** Tools the role may not use, on top of `tools`. */
  excludeTools?: string[];
  thinking?: ThinkingLevel;
  /** Tool-call cap of the loop guard for this role's threads. Absent is the default. */
  maxToolCalls?: number;
  description: string;
  /** Prompt text from a role file; `promptMode` says whether it follows or replaces the built-in role prompt. */
  prompt?: string;
  promptMode?: "append" | "replace";
  /** Hidden from the agent tool and refused for new children by `HostConfig.agentOverrides`. */
  disabled?: boolean;
  /** Only for top-level threads (`thread.create {role}`): not offered to the agent tool or accepted for sub-agents. */
  standalone?: boolean;
}

/** Per-role settings on top of a built-in or file role. Can only narrow tools, never widen them. */
export interface AgentOverride {
  model?: ModelSpec;
  thinking?: ThinkingLevel;
  tools?: string[];
  excludeTools?: string[];
  /** Tool calls one run of this role's sub-agent threads may make before the loop guard stops it (positive integer up to 1000; default 60). */
  maxToolCalls?: number;
  disabled?: boolean;
}

export type PlanStepStatus = "pending" | "in_progress" | "done" | "blocked";

/** One step of a thread's plan, optionally blocked on other steps via `dependsOn`. */
export interface PlanStep {
  id: string;
  title: string;
  status: PlanStepStatus;
  dependsOn?: string[];
  note?: string;
}

/** The structured plan an agent maintains for a thread. */
export interface Plan {
  steps: PlanStep[];
  updatedAt: number;
}

/** Lifecycle of a goal: `running` and `paused` are live, the rest are terminal. */
export type GoalStatus = "running" | "paused" | "met" | "impossible" | "budget_exhausted" | "no_progress";

/** Persisted state of the goal loop for a thread, including budgets and progress counters. */
export interface GoalState {
  text: string;
  status: GoalStatus;
  turns: number;
  maxTurns: number;
  /** Billed tokens across the goal: input, output and cache reads and writes. Budgets compare against this. */
  tokensUsed: number;
  /** Of `tokensUsed`, the share that was cache reads. */
  cacheReadTokens?: number;
  maxTokens?: number;
  /** Shell command run in the project cwd at each settled turn; exit code 0 means the goal is met. */
  check?: string;
  /** Opt-in cadence: every this many continuations the next turn is a replan turn. Unset means only after a stalled verdict. */
  replanEvery?: number;
  /** Turns settled since the last replan turn. */
  sinceReplan: number;
  noProgressTurns: number;
  lastVerdict?: string;
  pausedReason?: string;
  updatedAt: number;
}

export interface ThreadSummary {
  id: string;
  projectId: string;
  title: string;
  sessionFile?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  status: ThreadStatus;
  /** True when the host has a live AgentSession for the thread. */
  loaded: boolean;
  /** Set on child threads spawned by another thread's agent. */
  parentId?: string;
  role?: AgentRoleName;
}

export interface ModelRef {
  provider: string;
  id: string;
}

/** A role's model: a concrete model, or `tier:<name>` resolved through `HostConfig.modelTiers` when the child starts. */
export type ModelSpec = ModelRef | `tier:${string}`;

export interface ModelInfo extends ModelRef {
  name: string;
  reasoning: boolean;
  contextWindow?: number;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** "auto" lets the client decide per message whether to think; a level pins it. */
export type ThinkingMode = "auto" | ThinkingLevel;

/** What a decision log entry describes. */
export type DecisionKind = "goal_verdict" | "goal_action" | "plan_change" | "agent_dispatch" | "agent_result" | "replan" | "judge_error";

/** One recorded decision by the goal loop or the model, with its reason and evidence. */
export interface DecisionEntry {
  /** Unique within the thread. */
  id: string;
  /** Epoch milliseconds when it was recorded. */
  ts: number;
  kind: DecisionKind;
  /** One human-readable line. */
  summary: string;
  /** The stated why (the model's or the loop's rule). */
  reason?: string;
  /** What it was based on: a judge quote, command output, a verdict. */
  evidence?: string;
  /** Structured fields (turn numbers, budgets, role, childThreadId, plan op, verdict). */
  data?: Record<string, unknown>;
}

export interface ThreadSnapshot {
  summary: ThreadSummary;
  messages: ChatMessage[];
  model?: ModelRef;
  thinkingLevel: ThinkingLevel;
  thinkingMode: ThinkingMode;
  availableThinkingLevels: ThinkingLevel[];
  isStreaming: boolean;
  queue: { steering: string[]; followUp: string[] };
  tools: ToolInfo[];
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  plan?: Plan;
  goal?: GoalState;
  /** The thread's decision log, oldest first (the most recent 500). */
  decisions?: DecisionEntry[];
}

export interface ToolInfo {
  name: string;
  description: string;
  active: boolean;
  namespace?: string;
  exposure?: string;
}

export interface ProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  oauth: boolean;
  authTypes: ("api_key" | "oauth")[];
  /** True for a policy gateway that signs in through the organisation's identity provider. */
  sso?: boolean;
  /** Who is signed in (the ID token subject), when known. Only held for the current host process. */
  subject?: string;
}

/** Where clicked links open: the built-in browser, the system browser, or in-app only for the home page's site. */
export type LinkTarget = "builtin" | "home" | "external";
/** Which browser the agent drives: `auto` is the external Chrome when one is installed, else the built-in browser. */
export type BrowserEngineSetting = "auto" | "chrome" | "embedded";

export type ApprovalMode = "full-access" | "ask-writes" | "read-only";

/** How an MCP server's tools reach the model (Pi's `exposure`). */
export type McpExposure = "direct" | "deferred" | "codemode" | "hidden";

interface McpServerBase {
  /** Short id (letters, digits, `_`, `-`); tools appear as `mcp__<name>__<tool>` with `-` written as `_`. */
  name: string;
  exposure?: McpExposure;
  /** `false` keeps the entry without connecting. */
  enabled?: boolean;
  /** Per-request timeout in seconds. */
  timeout?: number;
  /** What the server is for, shown to the model. */
  description?: string;
}

/**
 * An MCP server in `$PISTA_HOME/pi/mcp.json` (the standard `mcpServers` format, see Pi's docs/mcp.md).
 * String values may reference environment variables as `${NAME}`; keep secrets that way, not literal.
 */
export type McpServerConfig = McpServerBase &
  (
    | { transport: "http"; url: string; headers?: Record<string, string> }
    | { transport: "stdio"; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  );

export type LocalServerKind = "lmstudio" | "ollama" | "llamacpp" | "openai";

/** A local OpenAI-compatible model server registered as a Pi provider. */
export interface LocalServer {
  id: string;
  kind: LocalServerKind;
  name: string;
  /** Origin without /v1, e.g. http://127.0.0.1:1234 */
  baseUrl: string;
}

export interface LocalModel {
  id: string;
  name?: string;
  /**
   * The server exposes a reasoning setting for this model. Models whose options lack "off"
   * cannot be switched off: Pi treats `off: null` as not offered.
   */
  reasoning?: boolean;
  loaded?: boolean;
  toolUse?: boolean;
  vision?: boolean;
  contextWindow?: number;
}

export interface LocalServerStatus extends LocalServer {
  running: boolean;
  added: boolean;
  models: LocalModel[];
}

export interface MemorySnapshot {
  enabled: boolean;
  dir: string;
  longTerm: string;
  scratchpad: string;
  daily: { date: string; content: string }[];
}

export interface HostConfig {
  /** Start page of the built-in browser; relative links resolve against it. */
  homeUrl: string;
  /** MCP servers, backed by `$PISTA_HOME/pi/mcp.json` rather than config.json. */
  mcpServers: McpServerConfig[];
  approvalMode: ApprovalMode;
  defaultModel?: ModelRef;
  /** Per-role model override for sub-agents. Superseded by `agentOverrides`, which wins where both set a model. */
  agentRoles?: Partial<Record<AgentRoleName, Pick<AgentRole, "model">>>;
  /** Per-role overrides applied on top of built-in and file roles. */
  agentOverrides?: Record<AgentRoleName, AgentOverride>;
  /**
   * Named model slots (`local`, `cheap`, `standard`, `strong`; any `[a-z0-9][a-z0-9_-]*`) that a role's `model` can
   * point at as `tier:<name>`. An unmapped tier falls back to the parent's model. The org model allowlist applies
   * to the resolved model.
   */
  modelTiers?: Record<string, ModelRef>;
  defaultThinkingMode: ThinkingMode;
  /**
   * Limits the top-level thread's own tools so it must delegate through the `agent` tool. `"delegate"` leaves it
   * `agent` and `plan`; `"delegate-read"` adds the read-only tools. `"lead"` keeps every tool and only adds a prompt section telling it to delegate exploration and large work. Sub-agents keep their role's tools. Absent is `"off"`.
   */
  orchestratorMode?: "off" | "delegate" | "delegate-read" | "lead" | "sliced";
  /** Id of the harness for top-level threads (`"solo"` by default; `"sliced"` is built in). When set, including `"solo"`, it overrides `orchestratorMode`; absent falls back to `orchestratorMode: "sliced"`, else solo. */
  harness?: string;
  /** Per-harness settings keyed by harness id. For sliced the legacy `sliced` key is still read when `harnessConfig.sliced` is absent. */
  harnessConfig?: Record<string, unknown>;
  /** Legacy alias of `harnessConfig.sliced`: settings for `orchestratorMode: "sliced"`, where the harness decides and drives delegation from the parent's slice list. */
  sliced?: {
    /** Fewer slices than this run solo (positive integer; default 3). */
    minSlices?: number;
    /** Slices that may run at once when their areas are disjoint (1 to 3; default 1). */
    maxParallel?: number;
    /** Tools the parent keeps while integrating the slices' results (default `"full"`). */
    integrateTools?: "read-only" | "full";
    /** A parent-declared small task runs solo only while the repo is under this fraction of the context window (greater than 0, at most 1; default 0.5). */
    repoSizeFraction?: number;
  };
  /** Extra system-prompt text appended for every thread. */
  instructions: string;
  linkTarget: LinkTarget;
  /** The agent's browser. Absent is `auto`. `PISTA_BROWSER_DRIVER` overrides it. */
  browserEngine?: BrowserEngineSetting;
  /** Cross-thread agent memory (pi-memory: markdown files the agent reads and writes). */
  memoryEnabled: boolean;
  /** Web search and page fetching tools (pi-web-access; Exa by default, no API key). */
  webSearchEnabled: boolean;
  /** The built-in browser tools (`browser_*`). Absent is on; `false` leaves them, and the Browser section of the system prompt, out. */
  browserEnabled?: boolean;
  /** Tool calls one run of a top-level thread may make before the loop guard stops it (positive integer up to 1000; default 60). Sub-agents use `agentOverrides[role].maxToolCalls`. */
  maxToolCalls?: number;
  /** Testing and evals: treat every model's context window as at most this many tokens. The entry point that registers providers applies the cap to the models (see `registerNebiusProvider`); the host scales compaction thresholds to the capped window for all models, as it does for local ones. */
  contextWindowCap?: number;
  /** Local model servers (LM Studio, Ollama, llama.cpp) added as providers. */
  localServers: LocalServer[];
  /** Built-in llama.cpp runtime (`llama-server` in router mode). Downloaded only once the user enables it. */
  llamaEnabled: boolean;
  /** Focused mode: the app opens as one guided job (paste transactions, collect invoices) instead of the general projects and chats UI. Absent is off. */
  focusedMode?: boolean;
  /** Ask before every saved-login sign-in (`browser_login`), even in full-access mode. Absent counts as on. */
  confirmSignIns?: boolean;
  /** Upper clamp on each model's per-response output cap, in tokens; undefined keeps the model's default. */
  maxOutputTokens?: number;
  /** Default verify gate for sub-agents that change files; a trusted project's `.pista/verify.json` wins. */
  verify?: { commands: string[]; timeoutSec?: number; maxAttempts?: number };
}

/** Which settings an organisation policy has locked. Locked keys are read-only for the user; the host rejects `config.set` patches that touch them. */
export interface ConfigPolicy {
  locked: ReadonlyArray<keyof HostConfig>;
  /** Present only when the policy restricts providers; lets the UI explain what is missing. */
  providers?: { allow?: string[]; disableDirectLogin?: boolean };
  /** Present only when the policy restricts models. */
  models?: { allow?: string[] };
  /** Present only when the policy has an `mcp` section: the servers it installed and whether users may add their own. */
  mcp?: { managedServers: string[]; allowUserServers: boolean };
  /** Present only when the policy has an `extensions` section: the Pi packages it installs and whether users may add their own. */
  extensions?: { managedPackages: string[]; allowUserPackages: boolean };
  /** Present only when the policy has a `tools` section (tool, shell command, MCP and skill rules). */
  tools?: { active: boolean };
}

/** The admin-owned policy file (see docs/ENTERPRISE.md). The host reads it at startup and never writes it. */
export interface ManagedPolicy {
  version: 1;
  /** Values forced on; clients cannot change these keys. */
  locked?: Partial<HostConfig>;
  /** Organisation defaults applied when the user has not set the key. */
  defaults?: Partial<HostConfig>;
  /** Model providers the organisation supplies. */
  providers?: {
    /** Company gateways (LiteLLM, Portkey, Azure, an internal proxy) registered at startup. */
    gateways?: PolicyGateway[];
    /** Provider ids employees may use (built-in ids and gateway ids). Absent means all. */
    allow?: string[];
    /** True stops employees from signing in to providers themselves (OAuth or API key); gateways keep working. */
    disableDirectLogin?: boolean;
  };
  /** Model restrictions. */
  models?: {
    /** Entries "provider/id" or "provider/*". Absent means all models of the allowed providers. */
    allow?: string[];
  };
  /** MCP servers the organisation installs and controls. */
  mcp?: {
    /** Servers written into mcp.json at every start, by name, in the standard `mcpServers` entry format (`command`/`args`/`env` or `url`/`headers`, plus Pi's `exposure`, `enabled`, `toolExposure`). Employees cannot edit or remove them. Keep secrets as `${ENV}` references. */
    servers?: Record<string, Record<string, unknown>>;
    /** `false` stops employees adding MCP servers; editing the ones they already have stays possible. Default true. */
    allowUserServers?: boolean;
    /** Server names removed from mcp.json at startup and refused afterwards. */
    blockedServers?: string[];
  };
  /** Pi packages (extensions, skills, prompts) the organisation installs and controls. */
  extensions?: {
    /** Package sources written into Pi's `packages` setting at every session build: `npm:<name>@<exact-version>`, `git:<url>#<ref>` (or `@<ref>`), or a local path. Pinning is required for npm and git. */
    packages?: string[];
    /** `false` removes packages employees added themselves and keeps them out. Default true. */
    allowUserPackages?: boolean;
  };
  /** Which agent harnesses may run. A harness that is not allowed falls back to solo and is audited. */
  harnesses?: {
    /** Harness ids that may run (built-in or from a package); any other id is denied. Absent: all built-ins. An empty list denies every non-solo harness. Package harnesses also need their package in `extensions.packages`. */
    allow?: string[];
    /** `false` allows a harness only when the managed (locked) `harness` setting selects it. Default true. */
    allowUserHarnesses?: boolean;
  };
  /** Outbound network settings for corporate networks. Policy wins over the HTTPS_PROXY / HTTP_PROXY / NO_PROXY / NODE_EXTRA_CA_CERTS environment. */
  network?: {
    /** Proxy URL for all outbound requests (model providers, MCP over HTTP, OIDC). */
    proxy?: string;
    /** Hosts that bypass the proxy (NO_PROXY entries). */
    noProxy?: string[];
    /** PEM files of extra trusted CAs, read once at startup. An unreadable file stops the host. */
    caCertFiles?: string[];
    /** Also trust the operating system's certificate store. */
    useSystemCa?: boolean;
  };
  /** `false` switches off Pi's install telemetry / its version check. Absent keeps Pi's behaviour. */
  telemetry?: { piTelemetry?: boolean; versionCheck?: boolean };
  /** Domain rules for the agent's browser tools. Admin-locked and validated fail-closed. Entries: an exact host or `*.example.com` (subdomains only). Deny wins; `allowedDomains` denies everything else. */
  browser?: { allowedDomains?: string[]; deniedDomains?: string[] };
  /** Update control. Admin-only (no user setting) and validated fail-closed. Versions are semver `MAJOR.MINOR.PATCH[-prerelease]`, no leading "v". */
  updates?: {
    /** `false` switches the desktop updater off. */
    enabled?: boolean;
    channel?: "stable" | "beta";
    /** https URL of the update feed (http only for loopback). */
    feedUrl?: string;
    /** The host runs in blocked mode (no agent work) below this version. */
    minimumVersion?: string;
    /** ... and above this version. */
    maximumVersion?: string;
    /** Hours between forced update checks, 1..720. */
    enforcementHours?: number;
  };
  /** Audit export: the host sends OTLP/HTTP JSON logs to this collector. Admin-locked, no default tier. Header values are read from the named environment variables, never stored here. */
  audit?: {
    otlpEndpoint: string;
    protocol?: "http";
    headersEnv?: Record<string, string>;
    includePrompts?: boolean;
    includeToolArgs?: boolean;
    resourceAttributes?: Record<string, string>;
  };
  /** Local data retention. Admin-locked, no default tier; a missing block deletes nothing automatically. */
  retention?: {
    /** Threads (and their session files) idle for longer than this many days are deleted. */
    sessionDays?: number;
    /** Browser trace files older than this many days are deleted. */
    traceDays?: number;
    /** Run the purge at host startup (default true); false leaves it to the periodic run. */
    purgeOnStartup?: boolean;
  };
  /**
   * Tool rules, enforced in the host for every tool call. Patterns are `*`/`?` globs, case-sensitive;
   * deny beats allow; an `allow` list that is present means "only these".
   */
  tools?: {
    /** Tool names (`bash`, `edit`, `mcp__github__*`, ...). Present: default-deny. Pista's own tools (agent, plan, tool_search, codemode) are always allowed here. */
    allow?: string[];
    deny?: string[];
    /** Patterns over the command units of a shell command (split on `;`, `&&`, `||`, `|`, newlines, `$(`, backticks and `bash -c` payloads). Best effort, not a sandbox. */
    bash?: { allow?: string[]; deny?: string[] };
    /** `"server"` or `"server/tool"`, matched against the tool `mcp__<server>__<tool>`. */
    mcp?: { allow?: string[]; deny?: string[] };
    /** Skill names. `allow: []` loads no skills. */
    skills?: { allow?: string[]; deny?: string[] };
  };
}

/** One gateway declared in the policy. The API key is never in the file: `apiKeyEnv` names the host environment variable that holds it. */
export interface PolicyGateway {
  /** Provider id as shown in the UI and used in model refs. */
  id: string;
  name: string;
  kind: "openai-compatible" | "anthropic-compatible";
  /** https required unless the host is localhost or 127.0.0.1. */
  baseUrl: string;
  apiKeyEnv?: string;
  /**
   * Employees sign in with the company's OIDC identity provider (OAuth 2.0 device authorization grant) instead of a provisioned key.
   * Mutually exclusive with `apiKeyEnv`. The token Pi stores is sent as the bearer.
   */
  auth?: PolicyGatewayOidc;
  /** Static headers; values may be "$ENV" references. */
  headers?: Record<string, string>;
  models: Array<{ id: string; name?: string; contextWindow?: number; maxTokens?: number; reasoning?: boolean }>;
}

/** OIDC sign-in for a gateway. The host reads `<issuer>/.well-known/openid-configuration`; the IdP app must be a public client with the device authorization grant. */
export interface PolicyGatewayOidc {
  type: "oidc";
  /** https issuer URL, no query or fragment. */
  issuer: string;
  /** Public client id of the IdP app registration. */
  clientId: string;
  /** Requested scopes. `openid` and `offline_access` are always requested. */
  scopes?: string[];
  /** Which token is sent as the bearer: the access token (default) or the ID token. */
  token?: "id" | "access";
  /** Sent as `audience` on the device authorization request (Auth0 style). */
  audience?: string;
}

/** A `config.set` patch. `maxOutputTokens: null` clears the cap (JSON drops `undefined`). */
export type ConfigPatch = Omit<Partial<HostConfig>, "maxOutputTokens"> & { maxOutputTokens?: number | null };

/** Install/run state of the built-in llama.cpp runtime. `mode` follows PISTA_LLAMA_RUNTIME. */
export interface LlamaRuntimeStatus {
  state: "unsupported" | "not-installed" | "installing" | "installed" | "starting" | "running" | "error";
  mode: "managed" | "external" | "off";
  message?: string;
  /** While installing: bytes downloaded so far, and the expected total. */
  progress?: { bytes: number; total?: number };
  /** Router URL (no `/v1`) while running. */
  baseUrl?: string;
  /** Pinned llama.cpp release tag. */
  build?: string;
  /** Asset key: `darwin-arm64`, `linux-x64`, `linux-arm64`, `win32-x64` or `win32-arm64`. */
  platform?: string;
  /** Which llama.cpp build is selected for this platform (PISTA_LLAMA_VARIANT can override). */
  variant?: "metal" | "vulkan" | "cpu";
  /** Where the binary came from, once there is one: shipped inside the app, or downloaded to `$PISTA_HOME`. */
  source?: "bundled" | "downloaded";
}

/** A model served by the built-in llama.cpp router. `contextWindow` is what is loaded, or what the next load will give. */
export interface LlamaModel {
  /** Router id, e.g. `ggml-org/stories15M_MOE:Q8_0`. */
  id: string;
  name: string;
  loaded: boolean;
  status: "loaded" | "unloaded" | "loading" | "downloading" | "error";
  contextWindow?: number;
  /** Context the model was trained with; `contextWindow` never exceeds it. */
  trainedContext?: number;
  sizeBytes?: number;
  /** Known only for loaded models (read from the chat template). */
  reasoning?: boolean;
  message?: string;
}

/** Progress of one model download (`spec` is `<org>/<repo>:<quant>`). Throttled to a few per second. */
export interface LlamaDownload {
  spec: string;
  bytes: number;
  total?: number;
  done?: boolean;
  error?: string;
  /** Where the download stands: "starting" until the first progress arrives. Hosts that predate it omit it; `done` and `error` still tell the end. */
  phase?: "starting" | "downloading" | "done" | "error";
}

/** A GGUF repo on Hugging Face. `files` is empty in search results and filled by `llama.models.inspect`. */
export interface LlamaHubModel {
  id: string;
  downloads?: number;
  likes?: number;
  /** `unresolved`: a GGUF file whose name yields no quant tag; `quant` is then the bare file name and it cannot be downloaded from here. */
  files: { quant: string; sizeBytes: number; unresolved?: boolean }[];
}

export interface McpServerStatus {
  name: string;
  toolCount: number;
  exposure?: string;
}

/** Result of checking the running app version against the policy's `updates` range. */
export type VersionGate = { status: "ok" } | { status: "below" | "above"; current: string; minimumVersion?: string; maximumVersion?: string };

/** Non-secret updater settings, resolved by the host (policy plus PISTA_DISABLE_AUTOUPDATER). */
export interface UpdatesSummary {
  enabled: boolean;
  channel: "stable" | "beta";
  feedUrl?: string;
  enforcementHours?: number;
}

export interface HostInfo {
  version: string;
  piVersion: string;
  platform: string;
  homeDir: string;
  config: HostConfig;
  policy: ConfigPolicy;
  /** Path of the managed policy file in force, or null. */
  policySource: string | null;
  /** Blocked mode when not "ok": agent work is refused with `version_blocked`. */
  versionGate: VersionGate;
  updates: UpdatesSummary;
  /** Where each setting's current value comes from. */
  configSources: Partial<Record<keyof HostConfig, ConfigSource>>;
  projects: Project[];
  /** Which browser the agent drives: the UI's pane, a CDP Chromium, or an external Chrome shown as a live view. Absent on older hosts (pane). */
  browserEngine?: "pane" | "cdp" | "chrome";
  /** Why that engine (for example `auto: no Chrome found`). */
  browserEngineReason?: string;
  /** Display name of the external browser when the engine is `chrome`. */
  browserName?: string;
  /** True when Chrome was wanted but none was found, so the built-in browser is used. */
  browserEngineFallback?: boolean;
}

/** One live-view frame of the agent's Chrome tab (engine "chrome"). `data` is a base64 JPEG. */
export interface BrowserFrame {
  data: string;
  width: number;
  height: number;
  url: string;
  title: string;
}

export type ConfigSource = "locked" | "policy" | "user" | "default";

// ---------------------------------------------------------------------------
// Browser bridge: the agent drives the UI's built-in browser through these.
// ---------------------------------------------------------------------------

/** Trusted input the desktop shell injects like a real user would (CSS px of the page viewport). */
export type BrowserInput = { type: "click"; x: number; y: number } | { type: "text"; text: string } | { type: "key"; key: string };

/**
 * Primitives the host's browser driver sends to the UI. Snapshots, refs and actions are built
 * on these in @pista/pi-browser. `activity` is a short label for the badge over the page.
 */
export type BrowserAction = (
  | { action: "navigate"; url: string }
  | { action: "state" }
  | { action: "screenshot" }
  | { action: "eval"; script: string }
  | { action: "input"; event: BrowserInput }
  | { action: "back" }
  | { action: "reload" }
  /** Arms the next download of the pane to save at `path` (absolute) inside the project folder `root`, which the shell checks; with `url` it also starts that download using the pane's session. */
  | { action: "download.arm"; path: string; root?: string; url?: string }
  /** Resolves with the armed download's result once it completed. Rejects when none started in time or it failed. */
  | { action: "download.wait" }
  /** Lists the saved logins (metadata only) the desktop shell holds. */
  | { action: "login.list" }
  /** Fills and submits the login form of the current page with the saved login `site` (id or label as the model names it). `site` resolves by exact match on a saved login's id or label only, never fuzzy or by origin; the fill happens only when the pane's current page origin equals the saved origin. */
  | { action: "login.fill"; site: string }
) & { activity?: string };

/**
 * A saved login as the host and the model see it. The password is never part of this type and
 * never leaves the desktop main process.
 */
export type SavedLoginMeta = {
  /** Stable id of the saved login. */
  id: string;
  /** Short name the model uses to pick it. */
  label: string;
  /** Origin the login is bound to; it is only filled on this origin. */
  origin: string;
  /** Account name, shown to help tell logins apart. */
  username?: string;
};

export interface BrowserResult {
  url?: string;
  title?: string;
  loading?: boolean;
  text?: string;
  value?: unknown;
  image?: { data: string; mimeType: string };
  download?: { bytes: number; contentType?: string; url?: string; urlChain?: string[] };
  note?: string;
  /** Result of `login.list`. */
  logins?: SavedLoginMeta[];
  /** Result of `login.fill`; `note` is a short generic status, never page content. */
  login?: { ok: boolean; note: string };
}

// ---------------------------------------------------------------------------
// Auth prompts (provider login flows relayed to the UI)
// ---------------------------------------------------------------------------

export type AuthPrompt =
  | { type: "text" | "secret"; message: string; placeholder?: string }
  | { type: "select"; message: string; options: { id: string; label: string; description?: string }[] }
  | { type: string; message?: string; [key: string]: unknown };

// ---------------------------------------------------------------------------
// Playbooks: a learned path through a site, replayed by the host (credentials are never stored)
// ---------------------------------------------------------------------------

/** What a repeated element's row is matched on at replay time. */
export type PlaybookRowMatch = ("date" | "amount")[];

export interface PlaybookLocator {
  role?: string;
  name?: string;
  text?: string;
  selector?: string;
  frameUrl?: string;
  /** The locator names the repeated element (e.g. each row's download link); the row is chosen at replay time from the job's invoice. No row content is stored. */
  row?: { match: PlaybookRowMatch };
  /** The locator is a period selector (a month tab or link) of this role: the one whose label covers the invoice's date is chosen at replay time. No name is stored. */
  period?: boolean;
}
export interface PlaybookExpect { urlIncludes?: string; text?: string; element?: PlaybookLocator }
export type PlaybookStep =
  | { kind: "navigate"; url: string; expect?: PlaybookExpect }
  /** `opensTab`: the recorded click opened a new tab, which replay waits for and follows. */
  | { kind: "click"; target: PlaybookLocator; fallbacks?: PlaybookLocator[]; expect?: PlaybookExpect; opensTab?: true }
  /** Replay fills the saved login for `origin`; no credential is part of the playbook. */
  | { kind: "signIn"; origin: string; expect?: PlaybookExpect }
  | { kind: "wait"; expect: PlaybookExpect }
  /** `verify`: what proves it is the wanted invoice: the row the control sits in (default), or the page it is on (a detail page that shows the invoice date and amount). */
  | { kind: "download"; target?: PlaybookLocator; url?: string; fileType?: string; verify?: "row" | "page" };

/** `host/path` of an address (no scheme, query or fragment), for display as text. */
export function hostPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url.slice(0, 80);
  }
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search || "/";
  } catch {
    return url;
  }
}

/** One plain, readable line for a playbook step. Playbooks are untrusted: the result is rendered as text only. */
export function describeStep(step: PlaybookStep): string {
  switch (step.kind) {
    case "navigate":
      return `Open ${pathOf(step.url)}`;
    case "signIn":
      return "Sign in with saved login";
    case "click": {
      const t = step.target;
      if (t?.period) return "Pick the invoice's month";
      if (t?.row) return "Pick the row matching the invoice date";
      const noun = t?.role === "link" ? " link" : t?.role === "button" ? " button" : "";
      return `Click${noun} '${t?.name || t?.text || t?.selector || t?.role || "element"}'`;
    }
    case "wait":
      return step.expect?.text ? `Wait for '${step.expect.text}'` : step.expect?.urlIncludes ? `Wait for page '${step.expect.urlIncludes}'` : "Wait for the page";
    case "download":
      return `Download${step.fileType ? ` (${step.fileType.toUpperCase()})` : ""}`;
    default:
      return `Step: ${String((step as { kind?: unknown }).kind)}`;
  }
}

export interface PlaybookNote { text: string; at: string; by: "model" | "user" }
export interface PlaybookAvoid { url: string; why: string; at: string }

export interface PlaybookShortcut { url: string; afterStep: number }

export interface Playbook {
  version: 1;
  /** Registrable domain the playbook belongs to. */
  site: string;
  /** Registrable domains the path may visit (at most 4, `site` first), e.g. a vendor and its payment page. Replay stops on any other. */
  hosts: string[];
  startUrl: string;
  steps: PlaybookStep[];
  /**
   * An address that is already past stored step `afterStep` (1-based): replay may open `url` and continue with the step after it,
   * skipping the earlier clicks. It never reaches a step that depends on the invoice or the download. Replay falls back to the full
   * path from `startUrl` (and drops the shortcut) when the page does not show what step `afterStep` expects.
   */
  shortcut?: PlaybookShortcut;
  /** A shortcut seen on one successful run; it becomes `shortcut` when the next successful run shows the same one. */
  shortcutCandidate?: PlaybookShortcut;
  /** Consecutive runs where the shortcut did not check out and the full path then worked; the shortcut is dropped at 2. */
  shortcutFails?: number;
  /** Upper-case keywords (at most 5) that a bank or card transaction's merchant text contains when it belongs to this site. Never raw merchant text. */
  merchants?: string[];
  /** Keywords the model suggested when saving; they are never used for matching until a verified download of a matching transaction confirms them, or, when broad (`merchantsPendingWhy`), the user does (`playbook.setMerchants`). `*` is only allowed in keywords the user set. */
  merchantsPending?: string[];
  /** Why a pending keyword waits for the user instead of being confirmed by a verified download (it is broad). Keyed by keyword. */
  merchantsPendingWhy?: Record<string, "short" | "umbrella" | "other-site" | "unsure">;
  /** Consecutive routed runs that ended without the invoice's row; a confirmed keyword is dropped at 2 misses on different transactions. Keyed by keyword. */
  merchantMisses?: Record<string, number>;
  /** Short hash of the last transaction that missed, per keyword, so a retry of it is not counted twice. */
  merchantLastMiss?: Record<string, string>;
  /** What replays learned about how the site bills: `currency` is the transaction currency a converted charge was compared in, `dayOffset` the average days from the transaction to the row's date, `rate` the average rate (row currency to `currency`) that made rows fit, over `samples` verified runs. */
  billing?: { currency: string; dayOffset: number; rate?: number; samples: number };
  /** Facts about the site (at most 8, one line, 200 characters). Advisory data shown to the model when it browses anyway; never replayed. */
  notes: PlaybookNote[];
  /** Addresses on the playbook's hosts to stay away from (at most 8; origin and path only). Advisory, never replayed. */
  avoid: PlaybookAvoid[];
  createdAt: string;
  updatedAt: string;
  lastSucceeded?: string;
  successCount: number;
  /** Consecutive failures since the last success. */
  failCount: number;
  status: "ok" | "needs-attention";
  history: { at: string; summary: string }[];
}

/** Why the host refused a keyword the user typed. */
export type MerchantRefusal = "too-short" | "too-long" | "wildcard-placement" | "too-many-wildcards" | "too-general" | "too-many" | "not-pending";

export interface PlaybookMeta {
  site: string;
  /** Only when the playbook spans more than its own site. */
  hosts?: string[];
  startUrl: string;
  /** Where replay opens the list directly, when a shortcut is known. */
  shortcutUrl?: string;
  merchants?: string[];
  merchantsPending?: string[];
  merchantsPendingWhy?: Playbook["merchantsPendingWhy"];
  stepCount: number;
  status: Playbook["status"];
  lastSucceeded?: string;
  successCount: number;
  failCount: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// RPC surface
// ---------------------------------------------------------------------------

export interface Methods {
  /** Liveness probe: the UI sends it while idle and treats any reply as proof the socket is alive. */
  "host.ping": { params: Record<string, never>; result: null };
  "host.hello": { params: { client?: { nativeBrowser: boolean } }; result: HostInfo };
  "config.set": { params: { patch: ConfigPatch }; result: HostConfig };

  "projects.add": { params: { path: string; name?: string }; result: Project };
  "projects.setTrusted": { params: { projectId: string; trusted: boolean }; result: Project };
  /** Reads a text file under the project folder (at most 1 MB); a path outside the folder is rejected. */
  "project.readFile": { params: { projectId: string; relPath: string }; result: { exists: boolean; content?: string; /** Last change, ms since the epoch. */ modified?: number } };
  /** Shows the project's `invoices` folder in the OS file manager (selecting it, never opening it). */
  "project.reveal": { params: { projectId: string }; result: void };
  "projects.remove": { params: { projectId: string }; result: void };

  "threads.list": { params: {}; result: ThreadSummary[] };
  "thread.create": { params: { projectId: string; /** Run the thread as this role (built-in or role file), e.g. a named skill. Unknown name is rejected. */ role?: AgentRoleName }; result: ThreadSnapshot };
  "thread.open": { params: { threadId: string }; result: ThreadSnapshot };
  "thread.prompt": {
    params: { threadId: string; text: string; images?: ImageBlock[]; delivery?: "steer" | "followUp" };
    result: void;
  };
  "thread.abort": { params: { threadId: string }; result: void };
  "thread.rename": { params: { threadId: string; title: string }; result: void };
  "thread.archive": { params: { threadId: string }; result: void };
  "thread.setModel": { params: { threadId: string; model: ModelRef }; result: void };
  "thread.setThinking": { params: { threadId: string; mode: ThinkingMode }; result: void };
  "thread.compact": { params: { threadId: string }; result: void };
  "thread.goal.set": { params: { threadId: string; text: string; maxTurns?: number; maxTokens?: number; check?: string; replanEvery?: number }; result: GoalState };
  "thread.goal.pause": { params: { threadId: string }; result: GoalState };
  "thread.goal.resume": { params: { threadId: string }; result: GoalState };
  "thread.goal.clear": { params: { threadId: string }; result: { ok: true } };
  "thread.bash": { params: { threadId: string; command: string }; result: { output: string; exitCode?: number } };

  "models.list": { params: {}; result: ModelInfo[] };
  "auth.providers": { params: {}; result: ProviderStatus[] };
  "auth.login": { params: { provider: string; type: "api_key" | "oauth"; apiKey?: string }; result: void };
  "auth.logout": { params: { provider: string }; result: void };
  "auth.cancel": { params: { provider: string }; result: void };
  "auth.promptResponse": { params: { promptId: string; value: string | null }; result: void };
  "memory.get": { params: {}; result: MemorySnapshot };
  "local.detect": { params: {}; result: LocalServerStatus[] };
  "local.add": { params: { kind: LocalServerKind; name: string; baseUrl: string }; result: void };
  "local.remove": { params: { id: string }; result: void };
  "llama.status": { params: {}; result: LlamaRuntimeStatus };
  /** Turns on the built-in llama.cpp runtime; downloads it first if needed (progress via `llama.status` events). */
  "llama.enable": { params: {}; result: void };
  "llama.disable": { params: {}; result: void };
  /** Disables the runtime and deletes the downloaded binary; models, cache and models.ini are kept. */
  "llama.remove": { params: {}; result: void };
  /** Router models. These start the runtime if it is installed but stopped. */
  "llama.models.list": { params: {}; result: LlamaModel[] };
  /** Resolves once the model is loaded. */
  "llama.models.load": { params: { id: string }; result: void };
  "llama.models.unload": { params: { id: string }; result: void };
  /** Starts a download and returns; progress arrives as `llama.download` events. `spec` is `<org>/<repo>:<quant>`. */
  "llama.models.download": { params: { spec: string }; result: void };
  /** Searches Hugging Face for GGUF repos (outbound HTTPS from the host; uses HF_TOKEN when set). */
  "llama.models.search": { params: { query: string }; result: LlamaHubModel[] };
  /** Lists the quantizations (with sizes) of one Hugging Face repo. */
  "llama.models.inspect": { params: { id: string }; result: LlamaHubModel };

  "playbook.list": { params: {}; result: PlaybookMeta[] };
  "playbook.get": { params: { site: string }; result: Playbook | null };
  "playbook.delete": { params: { site: string }; result: { ok: true } };
  /** Drops one suggested keyword. */
  "playbook.dismissMerchant": { params: { site: string; merchant: string }; result: { ok: true } };
  /** Replaces the site's confirmed merchant keywords (cleaned and capped by the host); `refused` lists the ones it did not accept, with why. Fails when the site has no playbook. */
  "playbook.setMerchants": { params: { site: string; merchants: string[] }; result: { ok: true; refused: { merchant: string; reason: MerchantRefusal }[] } };
  /** Takes one confirmed keyword away (undo of a learned one). Fails when the site has no playbook; `found: false` when the keyword was not confirmed. */
  "playbook.removeMerchant": { params: { site: string; merchant: string }; result: { ok: true; found: boolean } };
  /** Moves one pending keyword to the confirmed ones in a single step. Refuses when it is no longer pending, too broad, or the list is full. */
  "playbook.confirmMerchant": { params: { site: string; merchant: string }; result: { ok: true; refused?: MerchantRefusal } };
  /** Adds a note the owner wrote (`by: "user"`); the host trims and caps it and refuses an empty one. */
  "playbook.addNote": { params: { site: string; text: string }; result: { ok: true } };
  /** Removes the note at `index` (as listed in the playbook). */
  "playbook.removeNote": { params: { site: string; index: number }; result: { ok: true } };
  /** Removes the avoid entry at `index`. */
  "playbook.removeAvoid": { params: { site: string; index: number }; result: { ok: true } };

  "mcp.status": { params: { threadId?: string }; result: McpServerStatus[] };

  /** Checks whether a page allows being embedded in the web build's iframe browser. */
  "browser.probe": { params: { url: string }; result: { embeddable: boolean; reason?: string } };

  /** `note` on a decline tells the agent what to do instead; it then continues with that guidance. */
  "approval.respond": { params: { approvalId: string; allow: boolean; always?: boolean; note?: string }; result: void };
  /** Starts or stops the live view of the agent's Chrome tab for this window; frames arrive as `browser.frame` events only while subscribed. */
  "browser.view": { params: { subscribe: boolean }; result: void };
  /** Brings the agent's Chrome window to the front so the user can take over. */
  "browser.showChrome": { params: {}; result: void };
  "browser.respond": {
    params: { requestId: string; ok: boolean; result?: BrowserResult; error?: string };
    result: void;
  };
}

export type MethodName = keyof Methods;
export type Params<M extends MethodName> = Methods[M]["params"];
export type Result<M extends MethodName> = Methods[M]["result"];

export type HostEvent =
  | { type: "thread.event"; threadId: string; event: AgentEvent }
  | { type: "thread.updated"; thread: ThreadSummary }
  | { type: "thread.removed"; threadId: string }
  | { type: "browser.request"; requestId: string; threadId: string; request: BrowserAction }
  | ({ type: "browser.frame" } & BrowserFrame)
  | { type: "approval.request"; approvalId: string; threadId: string; toolName: string; args: unknown; reason: string; action?: string; toolLimit?: { used: number; more: number } }
  | { type: "approval.resolved"; approvalId: string }
  | { type: "auth.prompt"; promptId: string; provider: string; prompt: AuthPrompt }
  | {
      type: "auth.notice";
      provider: string;
      message: string;
      url?: string;
      done?: boolean;
      error?: string;
      /** What the notice asks of the user. Absent on older hosts, treat as "url" when `url` is set. */
      kind?: "url" | "device_code" | "progress" | "done";
      /** The code to enter on the verification page (kind "device_code"). */
      code?: string;
      /** When the code stops working, epoch milliseconds. */
      expiresAt?: number;
    }
  | { type: "config.changed"; config: HostConfig; configSources?: Partial<Record<keyof HostConfig, ConfigSource>> }
  | { type: "projects.changed"; projects: Project[] }
  | { type: "host_notification_request"; threadId: string; title: string; body: string }
  | { type: "toast"; level: "info" | "warn" | "error"; message: string }
  | { type: "llama.status"; status: LlamaRuntimeStatus }
  /** The full router model list, after any load, unload or download. */
  | { type: "llama.models"; models: LlamaModel[] }
  | ({ type: "llama.download" } & LlamaDownload)
  /**
   * Playbook progress shown as an in-chat card. Every string (site, reason, invoice, before, after) is untrusted display text: render as text only.
   * `invoice` is the job's own invoice and is shown only in this user's chat.
   */
  | {
      type: "playbook.event";
      threadId: string;
      kind: "learned" | "updated" | "followed" | "needs-attention" | "repairing";
      site: string;
      /** Step 0 is the start page; stored steps count from 1, so step 1 is `steps[0]`. For "updated" the first changed step (a changed start URL counts as step 1). */
      step?: number;
      stepCount?: number;
      /** Short failure reason, capped by the host. */
      reason?: string;
      invoice?: { date: string; amount?: number; currency?: string };
      /** Step labels for "updated". */
      before?: string;
      after?: string;
    }
  /**
   * What the host did with a pasted list of transactions before the model started. Sites and keywords are untrusted display text. No raw line or merchant text is ever included.
   * `ask` lists broad pending keywords that matched a pasted line: the user may confirm them (`playbook.confirmMerchant`, which refuses one that is no longer pending, too broad, or does not fit) or drop them (`playbook.dismissMerchant`). `learned` keywords can be undone (`playbook.removeMerchant`).
   */
  | {
      type: "playbook.firstPass";
      threadId: string;
      fetchedCount: number;
      /** All pasted lines, also when `lines` is capped. */
      total: number;
      lines: FirstPassLine[];
      learned: { site: string; keyword: string }[];
      ask: { site: string; keyword: string; why: "short" | "umbrella" | "other-site" | "unsure" }[];
    };

export interface FirstPassLine {
  lineNo: number;
  site?: string;
  /** Parsed values, yyyy-mm-dd; the amount is absolute. */
  date?: string;
  amount?: number;
  currency?: string;
  status: "fetched" | "exists" | "handed-off" | "declined" | "stopped" | "unmatched";
  /** Base name of the saved file. */
  file?: string;
  reason?: string;
}

export type ClientFrame = { kind: "req"; id: string; method: MethodName; params: unknown };
export type HostFrame =
  | { kind: "res"; id: string; ok: true; result: unknown }
  | { kind: "res"; id: string; ok: false; error: string }
  | { kind: "evt"; event: HostEvent };

export const DEFAULT_HOST_PORT = 4317;

/** The error message of a sign-in the user cancelled; the UI treats it quietly. */
export const LOGIN_CANCELLED = "Sign-in cancelled";
