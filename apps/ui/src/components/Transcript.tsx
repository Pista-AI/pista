import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Brain,
  Check,
  Bot,
  ChevronRight,
  CircleAlert,
  Database,
  Files,
  Globe,
  type LucideIcon,
  PencilLine,
  Search,
  ShieldQuestion,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import type { ChatMessage, ToolCallBlock } from "@pista/protocol";
import { RoleBadge } from "./RoleBadge.tsx";
import { actions, childrenOf, type Approval, type ThreadView, type ToolRun, useApp } from "../lib/store.ts";
import { duration, fmtTokens } from "../lib/format.ts";
import { openLink } from "../lib/links.ts";
import { groundedHosts, isGrounded, linkifyLocal, URL_ONLY, withScheme } from "../lib/linkify.ts";

/** Hosts seen in the current thread; null outside a transcript (no check). */
const GroundingContext = createContext<Set<string> | null>(null);

type ToolResultMsg = Extract<ChatMessage, { role: "toolResult" }>;

type Step = { kind: "tool"; call: ToolCallBlock } | { kind: "thinking"; text: string };

type Item =
  | { kind: "user"; message: Extract<ChatMessage, { role: "user" }> }
  | { kind: "text"; text: string }
  | { kind: "group"; steps: Step[] }
  | { kind: "agent"; call: ToolCallBlock }
  | { kind: "error"; text: string }
  | { kind: "note"; text: string };

interface Turn {
  key: string;
  items: Item[];
  startedAt: number;
  endedAt: number;
}

/**
 * Codex-style layout: commentary stays inline as prose, and each run of consecutive
 * tool calls collapses into one summary line ("Edited a file, read files, ran commands").
 */
function buildTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  let turn: Turn | undefined;
  const begin = (ts: number) => {
    turn = { key: `${ts}-${turns.length}`, items: [], startedAt: ts, endedAt: ts };
    turns.push(turn);
    return turn;
  };
  const group = (t: Turn) => {
    const last = t.items.at(-1);
    if (last?.kind === "group") return last;
    const g: Item & { kind: "group" } = { kind: "group", steps: [] };
    t.items.push(g);
    return g;
  };

  for (const m of messages) {
    if (m.role === "user") {
      begin(m.timestamp).items.push({ kind: "user", message: m });
      continue;
    }
    const t = turn ?? begin(m.timestamp);
    t.endedAt = Math.max(t.endedAt, m.timestamp);
    if (m.role === "assistant") {
      for (const block of m.content) {
        if (block.type === "text" && block.text.trim()) t.items.push({ kind: "text", text: block.text });
        else if (block.type === "thinking" && block.thinking.trim()) group(t).steps.push({ kind: "thinking", text: block.thinking });
        else if (block.type === "toolCall" && block.name === "agent") t.items.push({ kind: "agent", call: block });
        else if (block.type === "toolCall") group(t).steps.push({ kind: "tool", call: block });
      }
      if (m.stopReason === "error") t.items.push({ kind: "error", text: m.errorMessage ?? "The model returned an error." });
      if (m.stopReason === "aborted") t.items.push({ kind: "note", text: "Stopped" });
    } else if (m.role === "compactionSummary") {
      t.items.push({ kind: "note", text: "Context compacted" });
    } else if (m.role === "bashExecution") {
      group(t).steps.push({
        kind: "tool",
        call: { type: "toolCall", id: `bash-${m.timestamp}`, name: "user_bash", arguments: { command: m.command, output: m.output } },
      });
    }
  }
  return turns;
}

// ---------------------------------------------------------------------------
// Tool classification
// ---------------------------------------------------------------------------

type Category = "edit" | "read" | "search" | "command" | "browse" | "web" | "fetch" | "service" | "script" | "think" | "other";

function category(name: string): Category {
  if (name === "edit" || name === "write") return "edit";
  if (name === "read" || name === "ls") return "read";
  if (name === "grep" || name === "find" || name === "tool_search") return "search";
  if (name === "bash" || name === "powershell" || name === "user_bash") return "command";
  if (name.startsWith("browser_")) return "browse";
  if (name === "web_search" || name === "get_search_content") return "web";
  if (name === "fetch_content") return "fetch";
  if (name.startsWith("mcp__")) return "service";
  if (name === "codemode") return "script";
  return "other";
}

const PHRASE: Record<Category, (n: number) => string> = {
  edit: (n) => (n === 1 ? "edited a file" : `edited ${n} files`),
  read: (n) => (n === 1 ? "read a file" : "read files"),
  search: () => "searched",
  command: (n) => (n === 1 ? "ran a command" : "ran commands"),
  browse: () => "used the browser",
  web: (n) => (n === 1 ? "searched the web" : `searched the web ${n} times`),
  fetch: (n) => (n === 1 ? "read a web page" : `read ${n} web pages`),
  service: (n) => (n === 1 ? "used a connected service" : `used connected services ${n} times`),
  script: (n) => (n === 1 ? "ran a script" : "ran scripts"),
  think: () => "thought",
  other: (n) => (n === 1 ? "used a tool" : "used tools"),
};

const ICON: Record<Category, LucideIcon> = {
  edit: PencilLine,
  read: Files,
  search: Files,
  command: SquareTerminal,
  browse: Globe,
  web: Search,
  fetch: Globe,
  service: Database,
  script: SquareTerminal,
  think: Brain,
  other: Wrench,
};

function summarize(steps: Step[]): { label: string; Icon: LucideIcon } {
  const counts = new Map<Category, number>();
  const editedFiles = new Set<string>();
  for (const s of steps) {
    const c = s.kind === "thinking" ? "think" : category(s.call.name);
    if (c === "edit" && s.kind === "tool") editedFiles.add(String(s.call.arguments.path ?? ""));
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  if (counts.has("edit")) counts.set("edit", editedFiles.size || 1);
  const visible = [...counts.entries()].filter(([c]) => c !== "think" || counts.size === 1);
  const label = visible.map(([c, n]) => PHRASE[c](n)).join(", ");
  const lead = counts.has("edit") ? "edit" : (visible[0]?.[0] ?? "other");
  return { label: label.charAt(0).toUpperCase() + label.slice(1), Icon: ICON[lead] };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v);
}

function base(path: unknown): string {
  return str(path).split("/").pop() || str(path);
}

function humanize(name: string): string {
  return name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Present-tense description for the live status line. */
function progress(call: ToolCallBlock): string {
  const a = call.arguments ?? {};
  switch (call.name) {
    case "read":
      return `Reading ${base(a.path)}`;
    case "edit":
    case "write":
      return `Editing ${base(a.path)}`;
    case "bash":
    case "powershell":
      return `Running ${str(a.command).split("\n")[0]}`;
    case "grep":
    case "find":
      return `Searching for ${str(a.pattern)}`;
    case "ls":
      return `Listing ${str(a.path ?? ".")}`;
    case "web_search":
      return `Searching the web for ${str(a.query ?? a.queries)}`;
    case "fetch_content":
      return `Reading ${str(a.url ?? a.urls)}`;
    case "browser_navigate":
      return `Opening ${str(a.url)}`;
    case "browser_read":
      return "Reading the page";
    case "browser_screenshot":
      return "Looking at the page";
    case "browser_click":
      return `Clicking ${str(a.selector)}`;
    case "browser_type":
      return `Typing into ${str(a.selector)}`;
    case "browser_eval":
      return "Running a script in the page";
    case "codemode":
      return "Running a script";
    case "tool_search":
      return `Finding tools for ${str(a.query)}`;
    default:
      if (call.name.startsWith("mcp__")) {
        const [, server, tool] = call.name.split("__");
        return `${humanize(server ?? "")}: ${(tool ?? "").replace(/_/g, " ")}`;
      }
      return humanize(call.name);
  }
}

export function describeTool(name: string, args: Record<string, unknown>): { verb: string; target: string } {
  switch (name) {
    case "read":
      return { verb: "Read", target: str(args.path) };
    case "bash":
    case "powershell":
    case "user_bash":
      return { verb: "Ran", target: str(args.command) };
    case "edit":
      return { verb: "Edited", target: str(args.path) };
    case "write":
      return { verb: "Wrote", target: str(args.path) };
    case "grep":
      return { verb: "Searched", target: str(args.pattern) };
    case "find":
      return { verb: "Found", target: str(args.pattern ?? args.path) };
    case "ls":
      return { verb: "Listed", target: str(args.path ?? ".") };
    case "codemode":
      return { verb: "Ran script", target: str(args.description ?? args.code ?? "").split("\n")[0] };
    case "tool_search":
      return { verb: "Searched tools", target: str(args.query) };
    case "web_search":
      return { verb: "Searched the web", target: str(args.query ?? args.queries) };
    case "fetch_content":
      return { verb: "Read", target: str(args.url ?? args.urls) };
    case "get_search_content":
      return { verb: "Read search results", target: "" };
    case "browser_navigate":
      return { verb: "Opened", target: str(args.url) };
    case "browser_read":
      return { verb: "Read page", target: "" };
    case "browser_screenshot":
      return { verb: "Captured screenshot", target: "" };
    case "browser_click":
      return { verb: "Clicked", target: str(args.selector) };
    case "browser_type":
      return { verb: "Typed into", target: str(args.selector) };
    case "browser_eval":
      return { verb: "Ran script in page", target: str(args.script).split("\n")[0] };
    default:
      if (name.startsWith("mcp__")) {
        const [, server, tool] = name.split("__");
        return { verb: humanize(server ?? "mcp"), target: (tool ?? "").replace(/_/g, " ") };
      }
      return { verb: humanize(name), target: Object.values(args).map(str).join(" ").slice(0, 120) };
  }
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export function Transcript({ view, threadId }: { view: ThreadView; threadId: string }) {
  const allApprovals = useApp((s) => s.approvals);
  const threads = useApp((s) => s.threads);
  // Approvals from sub-agent threads of this thread are surfaced here, tagged with the child's role.
  const approvals = useMemo(() => {
    const children = new Map(childrenOf(threads, threadId).map((t) => [t.id, t]));
    return allApprovals
      .filter((a) => a.threadId === threadId || children.has(a.threadId))
      .map((a) => ({ approval: a, from: children.has(a.threadId) ? (children.get(a.threadId)?.role ?? "child") : undefined }));
  }, [allApprovals, threads, threadId]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const turns = useMemo(() => buildTurns(view.messages), [view.messages]);
  const homeUrl = useApp((s) => s.config?.homeUrl);
  const grounded = useMemo(() => groundedHosts(view.messages, homeUrl), [view.messages, homeUrl]);
  const results = useMemo(() => {
    const map = new Map<string, ToolResultMsg>();
    for (const m of view.messages) if (m.role === "toolResult") map.set(m.toolCallId, m);
    return map;
  }, [view.messages]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  return (
    <GroundingContext.Provider value={grounded}>
    <div
      className="transcript"
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div className="transcript-inner">
        {turns.map((turn, i) => (
          <TurnView
            key={turn.key}
            turn={turn}
            results={results}
            runs={view.toolRuns}
            live={view.isStreaming && i === turns.length - 1}
            liveStartedAt={view.turnStartedAt}
          />
        ))}
        {view.retry && <div className="msg-note">{view.retry}</div>}
        {view.compacting && <div className="msg-note">Compacting context…</div>}
        {approvals.map(({ approval, from }) => (
          <ApprovalCard key={approval.approvalId} approval={approval} from={from} />
        ))}
      </div>
    </div>
    </GroundingContext.Provider>
  );
}

const TurnView = memo(function TurnView({
  turn,
  results,
  runs,
  live,
  liveStartedAt,
}: {
  turn: Turn;
  results: Map<string, ToolResultMsg>;
  runs: Record<string, ToolRun>;
  live: boolean;
  liveStartedAt?: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);

  const last = turn.items.at(-1);
  const isRunning = (s: Step) =>
    s.kind === "tool" && (runs[s.call.id]?.status ?? (results.has(s.call.id) ? "done" : "running")) === "running";
  const lastGroupLive = live && last?.kind === "group";
  const hadWork = turn.items.some((it) => it.kind === "group");

  return (
    <>
      {turn.items.map((item, i) => {
        switch (item.kind) {
          case "user":
            return <UserBubble key={i} message={item.message} />;
          case "text":
            return (
              <div key={i} className="msg-assistant">
                <Markdown text={item.text} />
              </div>
            );
          case "group": {
            const active = lastGroupLive && i === turn.items.length - 1;
            const running = active ? [...item.steps].reverse().find(isRunning) : undefined;
            const liveLabel = running?.kind === "tool" ? progress(running.call) : active ? "Thinking" : undefined;
            return <ActionGroup key={i} steps={item.steps} results={results} runs={runs} liveLabel={liveLabel} />;
          }
          case "agent": {
            // Consecutive sub-agent cards share one track, so they read as stations along a single line.
            if (turn.items[i - 1]?.kind === "agent") return null;
            const calls: ToolCallBlock[] = [];
            for (let j = i; ; j++) {
              const it = turn.items[j];
              if (it?.kind !== "agent") break;
              calls.push(it.call);
            }
            return (
              <div key={i} className="agent-track">
                {calls.map((c) => (
                  <AgentToolCard key={c.id} call={c} result={results.get(c.id)} run={runs[c.id]} />
                ))}
              </div>
            );
          }
          case "error":
            return (
              <div key={i} className="msg-error">
                <CircleAlert size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                {item.text}
              </div>
            );
          case "note":
            return (
              <div key={i} className="msg-note">
                {item.text}
              </div>
            );
        }
      })}
      {live && !lastGroupLive && last?.kind !== "text" && (
        <div className="action-line static">
          <Brain size={15} />
          <span className="shimmer">Thinking</span>
        </div>
      )}
      {!live && hadWork && turn.endedAt - turn.startedAt > 1500 && (
        <div className="worked-for">Worked for {duration(turn.endedAt - turn.startedAt)}</div>
      )}
      {live && liveStartedAt !== undefined && now - liveStartedAt > 5000 && (
        <div className="worked-for">Working for {duration(now - liveStartedAt)}</div>
      )}
    </>
  );
});

function ActionGroup({
  steps,
  results,
  runs,
  liveLabel,
}: {
  steps: Step[];
  results: Map<string, ToolResultMsg>;
  runs: Record<string, ToolRun>;
  liveLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const { label, Icon } = summarize(steps);
  const failed = steps.some((s) => s.kind === "tool" && (runs[s.call.id]?.status === "error" || results.get(s.call.id)?.isError));

  return (
    <div className="action-group">
      <button className={`action-line ${open ? "open" : ""}`} onClick={() => setOpen(!open)}>
        <Icon size={15} />
        {liveLabel ? <span className="shimmer label">{liveLabel}</span> : <span className="label">{label}</span>}
        {failed && !liveLabel && <CircleAlert size={13} color="var(--red)" />}
        <ChevronRight size={14} className="chev" />
      </button>
      {open && (
        <div className="work-body">
          {steps.map((s, i) =>
            s.kind === "tool" ? (
              <ToolStep key={s.call.id + i} call={s.call} result={results.get(s.call.id)} run={runs[s.call.id]} />
            ) : (
              <div key={i} className="thinking">
                {s.text}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** First line of the host's `continuationPrompt` (apps/host/src/goal.ts). */
const GOAL_CONTINUATION_PREFIX = "Continue working toward the goal below.";
/** First line of the host's `replanPrompt`. */
const GOAL_REPLAN_PREFIX = "Replan checkpoint:";

export function UserBubble({ message }: { message: Extract<ChatMessage, { role: "user" }> }) {
  const blocks = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
  const first = blocks[0];
  if (first?.type === "text" && (first.text.startsWith(GOAL_CONTINUATION_PREFIX) || first.text.startsWith(GOAL_REPLAN_PREFIX))) {
    const used = /Progress: (\d+) of at most/.exec(first.text)?.[1];
    const label = first.text.startsWith(GOAL_REPLAN_PREFIX) ? "Replan checkpoint" : "Goal continuation";
    return <div className="goal-marker">{label}{used ? `, turn ${Number(used) + 1}` : ""}</div>;
  }
  return (
    <div className="msg-user">
      {blocks.map((b, i) =>
        b.type === "image" ? <img key={i} src={`data:${b.mimeType};base64,${b.data}`} alt="" /> : <span key={i}>{b.text}</span>,
      )}
    </div>
  );
}

function Link({ href, children, code }: { href?: string; children: React.ReactNode; code?: boolean }) {
  const hosts = useContext(GroundingContext);
  const verified = !href || isGrounded(href, hosts);
  return (
    <a
      href={href}
      title={verified ? href : `Unverified link: this address didn't appear in anything you wrote or the agent looked up, so it may not exist.\n${href}`}
      className={[code ? "code-link" : "", verified ? "" : "unverified"].filter(Boolean).join(" ") || undefined}
      onClick={(e) => {
        e.preventDefault();
        if (href) openLink(href, e.metaKey || e.ctrlKey);
      }}
    >
      {children}
      {!verified && <CircleAlert size={12} className="unverified-icon" aria-label="Unverified link" />}
    </a>
  );
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const source = useMemo(() => linkifyLocal(text), [text]);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => <Link href={href}>{children}</Link>,
        // Agents often wrap URLs in backticks; keep the code look but make them clickable.
        code: ({ className, children }) => {
          const value = typeof children === "string" ? children.trim() : "";
          if (!className && URL_ONLY.test(value))
            return (
              <Link href={withScheme(value)} code>
                <code>{value}</code>
              </Link>
            );
          return <code className={className}>{children}</code>;
        },
      }}
    >
      {source}
    </ReactMarkdown>
  );
});

function resultContent(result: unknown): { text: string; images: { data: string; mimeType: string }[]; diff?: string } {
  const r = result as { content?: { type: string; text?: string; data?: string; mimeType?: string }[]; details?: { diff?: string } };
  const text = (r?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  const images = (r?.content ?? [])
    .filter((c) => c.type === "image")
    .map((c) => ({ data: c.data ?? "", mimeType: c.mimeType ?? "image/png" }));
  return { text, images, diff: typeof r?.details?.diff === "string" ? r.details.diff : undefined };
}

function ToolStep({ call, result, run }: { call: ToolCallBlock; result?: ToolResultMsg; run?: ToolRun }) {
  const [open, setOpen] = useState(false);
  const { verb, target } = describeTool(call.name, call.arguments ?? {});
  const status = run?.status ?? (result ? (result.isError ? "error" : "done") : "running");
  const body = resultContent(result ?? run?.result ?? run?.partial);
  const userBash = call.name === "user_bash";

  return (
    <div className="step" data-status={userBash && status === "running" ? "muted" : status}>
      <button className="step-head" onClick={() => setOpen(!open)}>
        <span className="verb">{verb}</span>
        {target && <span className="target">{target}</span>}
        <span className="status">
          {status === "error" ? <CircleAlert size={13} color="var(--red)" /> : null}
        </span>
      </button>
      {open && (
        <div className="step-detail">
          <div className="sect">
            <div className="label">Input</div>
            {JSON.stringify(call.arguments, null, 2)}
          </div>
          {body.diff && (
            <div className="sect">
              <div className="label">Diff</div>
              {body.diff.split("\n").map((line, i) => (
                <div key={i} className={`diff-line ${line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : ""}`}>
                  {line || " "}
                </div>
              ))}
            </div>
          )}
          {(body.text || body.images.length > 0) && (
            <div className="sect">
              <div className="label">{status === "error" ? "Error" : "Output"}</div>
              {body.text.length > 20000 ? `${body.text.slice(0, 20000)}\n…` : body.text}
              {body.images.map((img, i) => (
                <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="" />
              ))}
            </div>
          )}
          {userBash && (
            <div className="sect">
              <div className="label">Output</div>
              {str(call.arguments.output)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ approval, from }: { approval: Approval; from?: string }) {
  const { verb, target } = describeTool(approval.toolName, (approval.args ?? {}) as Record<string, unknown>);
  /** Optional guidance sent with a decline; the agent then continues with it instead of stopping. */
  const [note, setNote] = useState("");
  const decline = () => actions.respondApproval(approval.approvalId, false, false, note.trim() || undefined);
  return (
    <div className="approval">
      {from && <div className="a-from">from {from === "child" ? "a" : from} sub-agent</div>}
      <div className="a-title">
        <ShieldQuestion size={16} /> Approval needed: {approval.action ?? verb}
        {!approval.action && target && (
          <code style={{ fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{target.slice(0, 100)}</code>
        )}
      </div>
      <div style={{ color: "var(--text-2)", fontSize: 13 }}>
        <code>{approval.toolName}</code> — {approval.reason}
      </div>
      <pre>{JSON.stringify(approval.args, null, 2)}</pre>
      <input
        className="search a-note"
        placeholder="Optional: tell the agent what to do instead"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && note.trim()) void decline();
        }}
      />
      <div className="a-actions">
        <button className="pill-btn" onClick={() => void decline()}>
          {note.trim() ? "Decline & send" : "Decline"}
        </button>
        {!approval.action && (
          <button className="pill-btn" onClick={() => actions.respondApproval(approval.approvalId, true, true)}>
            Always allow
          </button>
        )}
        <button className="pill-btn primary" onClick={() => actions.respondApproval(approval.approvalId, true)}>
          <Check size={14} /> Allow
        </button>
      </div>
    </div>
  );
}

/** Matches the footer the host appends to an agent tool result, e.g. "[sub-agent thread abc, 123 tokens]". */
const AGENT_FOOTER = /\n*\[sub-agent thread ([^\],\s]+)[^\]]*\]\s*$/;

interface AgentDetails {
  childThreadId?: string;
  role?: string;
  toolCalls?: number;
  tokens?: number;
  cacheReadTokens?: number;
  aborted?: boolean;
}

function AgentToolCard({ call, result, run }: { call: ToolCallBlock; result?: ToolResultMsg; run?: ToolRun }) {
  const [open, setOpen] = useState(false);
  const args = call.arguments ?? {};
  const role = str(args.role);
  const briefLine = str(args.goal ?? args.brief).split("\n").find((l) => l.trim())?.trim() ?? "";
  const status = run?.status ?? (result ? (result.isError ? "error" : "done") : "running");
  const raw = result ?? run?.result ?? run?.partial;
  const details = ((raw as { details?: AgentDetails } | undefined)?.details ?? {}) as AgentDetails;
  const body = resultContent(raw);
  const footer = AGENT_FOOTER.exec(body.text);
  const childId = details.childThreadId ?? footer?.[1];
  const text = footer ? body.text.slice(0, footer.index).trim() : body.text.trim();
  const state = details.aborted ? "aborted" : status === "running" ? "running" : status === "error" ? "failed" : "done";
  return (
    <div className="agent-card" data-state={state}>
      <div className="a-row">
        <Bot size={15} />
        {role && <RoleBadge role={role} />}
        <span className="a-meta">
          {state}
          {details.toolCalls !== undefined && ` · ${details.toolCalls} tool call${details.toolCalls === 1 ? "" : "s"}`}
          {details.tokens ? ` · ${fmtTokens(details.tokens)} tokens${details.cacheReadTokens ? ` (${fmtTokens(details.cacheReadTokens)} cache reads)` : ""}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        {childId && (
          <button className="pill-btn" onClick={() => void actions.openThread(childId)}>
            Open thread
          </button>
        )}
      </div>
      <div className="a-brief" title={str(args.goal ?? args.brief)}>
        {briefLine}
      </div>
      {text && state !== "running" && (
        <>
          <button className="a-toggle" onClick={() => setOpen(!open)}>
            {open ? "Hide result" : "Show result"}
          </button>
          {open && <div className="a-result">{text}</div>}
        </>
      )}
      {footer && state !== "running" && <div className="a-footer">{footer[0].trim()}</div>}
    </div>
  );
}
