import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Orchestration metrics derived from a run's kept Pi session files. */
export interface SessionMetrics {
  /** Largest prompt (input + cacheRead + cacheWrite) the parent sent in one request. */
  parentPeakContext: number;
  compactions: number;
  childCompactions: number;
  parentTokens: number;
  childTokens: number;
  /** parentTokens / (parentTokens + childTokens); 1 when nothing was spent. */
  parentShare: number;
  /** The parent's `agent` calls by role; calls that only carry `continueId` count under "continue". */
  agentCallsByRole: Record<string, number>;
  /** Agent calls whose brief holds a fenced code block. */
  briefsWithCode: number;
  /** First to last timestamp across all session files. */
  wallClockSeconds: number;
}

interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

interface Part {
  type?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

interface Entry {
  type?: string;
  timestamp?: string;
  parentSession?: string;
  message?: { role?: string; usage?: Usage; content?: Part[] };
}

interface Session {
  entries: Entry[];
  isChild: boolean;
}

function readJsonl(file: string): Entry[] {
  const out: Entry[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Entry);
    } catch {
      // a truncated last line from a killed run
    }
  }
  return out;
}

const assistantUsage = (e: Entry) => (e.type === "message" && e.message?.role === "assistant" ? e.message.usage : undefined);
const total = (u: Usage) => (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);

/** Walks `dir` for session JSONL files; undefined when there are none. The parent is the session without a `parentSession` that makes the most agent calls (ties: the first file). */
export function sessionMetrics(dir: string): SessionMetrics | undefined {
  const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith(".jsonl")).sort();
  const sessions: Session[] = files
    .map((f) => {
      const entries = readJsonl(join(dir, f));
      return { entries, isChild: !!entries.find((e) => e.type === "session")?.parentSession };
    })
    .filter((s) => s.entries.length > 0);
  if (!sessions.length) return undefined;

  const agentCalls = (s: Session) =>
    s.entries.flatMap((e) => (e.type === "message" && e.message?.role === "assistant" && Array.isArray(e.message.content) ? e.message.content.filter((p) => p.type === "toolCall" && p.name === "agent") : []));
  const roots = sessions.filter((s) => !s.isChild);
  const parent = (roots.length ? roots : sessions).reduce((best, s) => (agentCalls(s).length > agentCalls(best).length ? s : best));

  const m: SessionMetrics = { parentPeakContext: 0, compactions: 0, childCompactions: 0, parentTokens: 0, childTokens: 0, parentShare: 1, agentCallsByRole: {}, briefsWithCode: 0, wallClockSeconds: 0 };
  let first = Infinity;
  let last = -Infinity;
  for (const s of sessions) {
    const isParent = s === parent;
    for (const e of s.entries) {
      const t = Date.parse(e.timestamp ?? "");
      if (Number.isFinite(t)) {
        first = Math.min(first, t);
        last = Math.max(last, t);
      }
      if (e.type === "compaction") {
        if (isParent) m.compactions++;
        else m.childCompactions++;
      }
      const u = assistantUsage(e);
      if (!u) continue;
      if (isParent) {
        m.parentTokens += total(u);
        m.parentPeakContext = Math.max(m.parentPeakContext, (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0));
      } else m.childTokens += total(u);
    }
  }
  for (const call of agentCalls(parent)) {
    const a = call.arguments ?? {};
    const role = typeof a.role === "string" && a.role ? a.role : "continue";
    m.agentCallsByRole[role] = (m.agentCallsByRole[role] ?? 0) + 1;
    if (typeof a.brief === "string" && a.brief.includes("```")) m.briefsWithCode++;
  }
  const spent = m.parentTokens + m.childTokens;
  if (spent > 0) m.parentShare = m.parentTokens / spent;
  if (last > first) m.wallClockSeconds = (last - first) / 1000;
  return m;
}
