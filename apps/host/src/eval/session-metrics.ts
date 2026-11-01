import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { looksLikeCode } from "../brief.ts";
import { listHarnesses } from "../harness/registry.ts";
import type { SessionEntryLike as Entry, SessionPart as Part, SessionUsage as Usage } from "../harness/types.ts";

/** Orchestration metrics derived from a run's kept Pi session files. */
export interface SessionMetrics {
  /** Largest prompt (input + cacheRead + cacheWrite) the parent sent in one request. */
  parentPeakContext: number;
  compactions: number;
  childCompactions: number;
  parentTokens: number;
  childTokens: number;
  /** parentTokens / (parentTokens + childTokens); undefined when nothing was spent. */
  parentShare?: number;
  /** The parent's `agent` calls by role; calls that only carry `continueId` count under "continue". */
  agentCallsByRole: Record<string, number>;
  /** Agent calls whose brief holds a fenced code block. */
  briefsWithCode: number;
  /** First to last timestamp across all session files. */
  wallClockSeconds: number;
  /** The harness-specific metrics of the parent session (see `Harness.eval`); absent when no harness measured anything. */
  harness?: { id: string; metrics: Record<string, unknown> };
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

const warned = new Set<string>();

/** Walks `dir` for session JSONL files; undefined when there are none. The parent is the session without a `parentSession` that makes the most agent calls (ties: the first file). */
export function sessionMetrics(dir: string): SessionMetrics | undefined {
  const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith(".jsonl")).sort();
  const sessions: Session[] = files
    .map((f) => {
      const entries = readJsonl(join(dir, f));
      return { entries, isChild: !!entries.find((e) => e.type === "session")?.parentSession };
    })
    .filter((s) => s.entries[0]?.type === "session"); // other *.jsonl (browser traces, ...) sit in the same tree
  if (!sessions.length) return undefined;

  const calls = (s: Session, ...names: string[]) =>
    s.entries.flatMap((e) => (e.type === "message" && e.message?.role === "assistant" && Array.isArray(e.message.content) ? e.message.content.filter((p) => p.type === "toolCall" && names.includes(p.name ?? "")) : []));
  const agentCalls = (s: Session) => calls(s, "agent");
  // A `slices` call dispatches work like an `agent` call, so a sliced parent still outranks its children.
  const dispatches = (s: Session) => calls(s, "agent", "slices").length;
  const roots = sessions.filter((s) => !s.isChild);
  const parent = (roots.length ? roots : sessions).reduce((best, s) => (dispatches(s) > dispatches(best) ? s : best));

  const m: SessionMetrics = { parentPeakContext: 0, compactions: 0, childCompactions: 0, parentTokens: 0, childTokens: 0, agentCallsByRole: {}, briefsWithCode: 0, wallClockSeconds: 0 };
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
    const pointers = Array.isArray(a.pointers) ? a.pointers.filter((p): p is string => typeof p === "string") : [];
    // `brief` is the pre-structured parameter; old sessions still carry it.
    if ([a.goal, a.constraints, a.brief, pointers.join("\n")].some((t) => typeof t === "string" && looksLikeCode(t))) m.briefsWithCode++;
  }
  // Built-ins win over package harnesses; the run config is not available here.
  const found = listHarnesses().flatMap((h) => {
    try {
      const metrics = h.eval?.metrics(parent.entries);
      return metrics ? [{ id: h.id, metrics }] : [];
    } catch (err) {
      if (!warned.has(h.id)) {
        warned.add(h.id);
        console.warn(`[pista-eval] harness ${h.id}: eval.metrics threw: ${err instanceof Error ? err.message : String(err)}`);
      }
      return [];
    }
  });
  if (found[0]) m.harness = found[0];
  const spent = m.parentTokens + m.childTokens;
  if (spent > 0) m.parentShare = m.parentTokens / spent;
  if (last > first) m.wallClockSeconds = (last - first) / 1000;
  return m;
}
