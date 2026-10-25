import type { ChatMessage, GoalState } from "@pista/protocol";
import { usageTotals } from "./models.ts";
import { clip } from "./text.ts";
import type { DecisionInput } from "./decisions.ts";
import {
  applySettle,
  capOutput,
  type CheckResult,
  checkFailureNote,
  CHECK_PROMPT_TAIL_CHARS,
  continuationPrompt,
  createGoal,
  type GoalAction,
  NO_PROGRESS_LIMIT,
  pause,
  replanPrompt,
  resume,
  type SettleKind,
  TRANSCRIPT_TAIL_CHARS,
  type Verdict,
} from "./goal.ts";

export type GoalJudge = (goal: GoalState, transcriptTail: string, threadId: string) => Promise<{ verdict?: Verdict; tokens: number; error?: string; raw?: string }>;

/** Longest reason stored in a decision; the full text stays in `evidence`. */
const REASON_MAX = 300;

/** 18000 becomes "18k"; small counts stay exact. */
function tokenCount(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/** What the thread layer returns for a check: the result, or why it was not run (read-only mode). Throws if it could not run. */
export type CheckOutcome = CheckResult | { skipped: string };
/** `isStale` turns true when the goal was paused, cleared or replaced; a runner that waited must then not execute. */
export type GoalCheckRunner = (threadId: string, command: string, isStale: () => boolean) => Promise<CheckOutcome>;

/** The goal fields every `goal_action` decision carries. */
function goalData(goal: GoalState): Record<string, unknown> {
  return {
    status: goal.status,
    turns: goal.turns,
    maxTurns: goal.maxTurns,
    tokensUsed: goal.tokensUsed,
    ...(goal.cacheReadTokens ? { cacheReadTokens: goal.cacheReadTokens } : {}),
    ...(goal.maxTokens !== undefined ? { maxTokens: goal.maxTokens } : {}),
    noProgressTurns: goal.noProgressTurns,
  };
}

/** The summary and the rule that fired for one settled turn. */
function describeSettle(goal: GoalState, action: GoalAction, kind: SettleKind, verdict: Verdict | undefined, check?: { command: string; exitCode: number }): { summary: string; reason: string } {
  const checkExit = check?.exitCode;
  if (kind !== "completed") return { summary: `Pause: ${goal.pausedReason ?? kind}`, reason: `the turn ended as ${kind}${goal.pausedReason ? ` (${goal.pausedReason})` : ""}; no judge call` };
  switch (goal.status) {
    case "met":
      return {
        summary: "Stop: goal met",
        reason: checkExit === 0 ? `Check command passed: ${check!.command}` : `Judge returned met; evidence: ${clip(verdict?.evidence ?? "", 200)}`,
      };
    case "impossible":
      return { summary: "Stop: goal judged impossible", reason: `the judge returned impossible; evidence: ${clip(verdict?.evidence ?? "", 200)}` };
    case "no_progress":
      return { summary: `Stop: no progress for ${goal.noProgressTurns} turns`, reason: `${goal.noProgressTurns} consecutive turns without progress (limit ${NO_PROGRESS_LIMIT}); the judge kept finding: ${clip(verdict?.evidence ?? "no parseable verdict", 200)}` };
    case "budget_exhausted": {
      const tokens = goal.maxTokens !== undefined && goal.tokensUsed >= goal.maxTokens;
      return {
        summary: `Stop: budget exhausted (${tokens ? `${goal.tokensUsed}/${goal.maxTokens} tokens` : `turn ${goal.turns}/${goal.maxTurns}`})`,
        reason: tokens ? `the token budget is used up: ${tokenCount(goal.tokensUsed)} of ${tokenCount(goal.maxTokens!)} tokens` : `the turn budget is used up: turn ${goal.turns} of ${goal.maxTurns}`,
      };
    }
    default: {
      const outcome = checkExit !== undefined && checkExit !== 0
        ? `check failed (exit ${checkExit}), so not met`
        : !verdict
          ? "unparseable judge reply, counted as no progress"
          : verdict.progress
            ? "not met, progress made"
            : "not met, no progress";
      const budget = `turn ${goal.turns} of ${goal.maxTurns}, ${tokenCount(goal.tokensUsed)} tokens used${goal.maxTokens !== undefined ? ` of ${tokenCount(goal.maxTokens)}` : ""}${goal.cacheReadTokens ? `, ${tokenCount(goal.cacheReadTokens)} of them cache reads` : ""}`;
      const stall = goal.noProgressTurns > 0 ? `${goal.noProgressTurns} of ${NO_PROGRESS_LIMIT} stalled turns` : "no stall";
      const reason = `${outcome}; ${budget}, ${stall}`;
      return { summary: `${action === "continue" ? "Continue toward goal" : "Pause"} (turn ${goal.turns}/${goal.maxTurns})`, reason };
    }
  }
}

/** What the runner needs from the thread layer. Continuations must go through the normal prompt path. */
export interface GoalHost {
  isStreaming(threadId: string): boolean;
  hasQueued(threadId: string): boolean;
  /** Sends a prompt exactly as a user message would (RunGuard, thinking, prepareModel, approvals apply). */
  prompt(threadId: string, text: string, isStale: () => boolean): Promise<void>;
  transcriptTail(threadId: string): string;
  /** Stores the goal in the session; `null` records a clear. */
  persist(threadId: string, goal: GoalState | null): void;
  emit(threadId: string, goal: GoalState | null): void;
  /** Writes to the thread's decision log. */
  record(threadId: string, entry: DecisionInput): void;
  /** What the turn that began at `sinceTs` showed: its first assistant text before any tool call, and the plan changes it made. */
  turnInfo?(threadId: string, sinceTs: number): { rationale?: string; planChanges: string[] };
}

/** Why the next continuation is a replan turn instead of a plain one. */
interface ReplanTrigger {
  trigger: "cadence" | "stalled";
  lastVerdict?: string;
}

/** The turn in flight: how it was started, so its settle can be explained. */
interface PendingTurn {
  kind: "continue" | "replan";
  trigger?: ReplanTrigger["trigger"];
  startedAt: number;
  /** Settled turns since the last replan when this turn was sent. */
  sinceReplan: number;
}

interface Slot {
  goal: GoalState;
  /** Bumped by anything that should invalidate an in-flight judge or pending continuation. */
  generation: number;
  pending?: PendingTurn;
}

/** Per-thread goal state machine driver. All scheduling decisions live here; `goal.ts` stays pure. */
export class GoalRunner {
  private slots = new Map<string, Slot>();

  constructor(
    private host: GoalHost,
    private judge: GoalJudge,
    private runCheck?: GoalCheckRunner,
  ) {}

  get(threadId: string): GoalState | undefined {
    return this.slots.get(threadId)?.goal;
  }

  /** Loads the persisted goal; a goal that was running when the host stopped comes back paused. */
  restore(threadId: string, saved: GoalState | null | undefined): void {
    if (!saved) return;
    const goal = pause({ ...saved, sinceReplan: saved.sinceReplan ?? 0 }, "Host restarted");
    this.slots.set(threadId, { goal, generation: 0 });
    if (goal.status !== saved.status) {
      this.commit(threadId);
      this.decide(threadId, goal, "pause", "Pause: Host restarted", "the host stopped while the goal was running");
    }
  }

  drop(threadId: string): void {
    this.slots.delete(threadId);
  }

  async set(threadId: string, text: string, opts: { maxTurns?: number; maxTokens?: number; check?: string; replanEvery?: number } = {}): Promise<GoalState> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Goal text is empty");
    const slot = this.slots.get(threadId);
    this.slots.set(threadId, { goal: createGoal(trimmed, opts), generation: (slot?.generation ?? 0) + 1 });
    this.commit(threadId);
    const created = this.slots.get(threadId)!.goal;
    this.decide(threadId, created, "set", `Goal set: ${clip(trimmed, 80)}`, "User set the goal", {
      maxTurns: created.maxTurns,
      ...(created.maxTokens !== undefined ? { maxTokens: created.maxTokens } : {}),
      ...(created.check ? { check: created.check } : {}),
      replanEvery: created.replanEvery ?? "off",
    });
    return this.kickoff(threadId);
  }

  pause(threadId: string, reason = "Paused by the user", why = "user"): GoalState {
    const slot = this.require(threadId);
    slot.generation++;
    const wasRunning = slot.goal.status === "running";
    slot.goal = pause(slot.goal, reason);
    this.commit(threadId);
    if (wasRunning) this.decide(threadId, slot.goal, "pause", `Pause: ${reason}`, why);
    return slot.goal;
  }

  /** Pauses a running goal (user abort, rejected prompt); anything else is left alone. */
  pauseIfRunning(threadId: string, reason: string): void {
    if (this.slots.get(threadId)?.goal.status === "running") this.pause(threadId, reason, reason === "Stopped by the user" ? "user" : reason);
  }

  async resume(threadId: string): Promise<GoalState> {
    const slot = this.require(threadId);
    if (slot.goal.status !== "paused") throw new Error("Only a paused goal can be resumed");
    slot.generation++;
    slot.goal = resume(slot.goal);
    this.commit(threadId);
    this.decide(threadId, slot.goal, "resume", "Goal resumed", "user");
    return this.kickoff(threadId);
  }

  clear(threadId: string): void {
    const slot = this.slots.get(threadId);
    if (!slot) return;
    this.slots.delete(threadId);
    this.host.persist(threadId, null);
    this.host.emit(threadId, null);
    this.decide(threadId, slot.goal, "clear", "Goal cleared", "user");
  }

  /** A real user message invalidates any pending judge result or continuation. */
  noteUserPrompt(threadId: string): void {
    const slot = this.slots.get(threadId);
    if (slot) slot.generation++;
  }

  /**
   * Called once per `agent_settled`. Judges the turn (only when it completed), applies the
   * result and, if the goal should go on, sends the next continuation.
   */
  async onSettle(threadId: string, kind: SettleKind, runTokens: number, runCacheRead = 0): Promise<void> {
    const slot = this.slots.get(threadId);
    if (!slot || slot.goal.status !== "running") return;
    const generation = slot.generation;
    const pending = slot.pending;
    slot.pending = undefined;

    let verdict: Verdict | undefined;
    let judgeSaw = "";
    let judgeTokens = 0;
    let judgeError: string | undefined;
    let judgeRaw: string | undefined;
    let check: { command: string; exitCode: number; durationMs: number; output: string } | undefined;
    let checkNote: string | undefined;
    let checkError: string | undefined;
    const command = slot.goal.check;
    if (kind === "completed" && command && this.runCheck) {
      try {
        const outcome = await this.runCheck(threadId, command, () => this.slots.get(threadId) !== slot || slot.generation !== generation);
        if ("skipped" in outcome) {
          this.host.record(threadId, { kind: "judge_error", summary: "Acceptance check skipped", reason: outcome.skipped, data: { turn: slot.goal.turns + 1, check: { command } } });
        } else {
          check = { command, exitCode: outcome.exitCode, durationMs: outcome.durationMs, output: capOutput(outcome.output) };
        }
      } catch (e) {
        checkError = e instanceof Error ? e.message : String(e);
      }
    }
    // The goal changed while the check ran or waited for approval: do not spend a judge call on it.
    if (this.slots.get(threadId) !== slot || slot.generation !== generation) return;
    if (check?.exitCode === 0) {
      verdict = { verdict: "met", progress: true, evidence: `check passed: ${command}` };
    } else if (kind === "completed" && checkError === undefined) {
      if (check) checkNote = checkFailureNote(check.command, check, CHECK_PROMPT_TAIL_CHARS);
      const tail = this.host.transcriptTail(threadId);
      const judgeNote = check ? checkFailureNote(check.command, check) : undefined;
      judgeSaw = judgeNote ? `${tail}\n\n${judgeNote}` : tail;
      ({ verdict, tokens: judgeTokens, error: judgeError, raw: judgeRaw } = await this.judge(slot.goal, judgeSaw, threadId));
    }
    // The user (or a pause/clear/set) acted while the check or judge ran: this result is stale.
    if (this.slots.get(threadId) !== slot || slot.generation !== generation) return;

    // The check is authoritative: a judge's "met" cannot override a failing check.
    let downgraded = false;
    if (check && check.exitCode !== 0 && verdict?.verdict === "met") {
      verdict = { verdict: "not_met", progress: verdict.progress, evidence: `check failed (exit ${check.exitCode}); judge said met: ${verdict.evidence}` };
      downgraded = true;
    }

    // An infrastructure failure is not "no progress": pause instead of burning the budget.
    const failure = checkError ?? judgeError;
    if (failure !== undefined) {
      const turn = slot.goal.turns + 1;
      const what = checkError !== undefined ? "Acceptance check" : "Judge";
      slot.goal = {
        ...pause(slot.goal, `${what} failed: ${failure}`),
        tokensUsed: slot.goal.tokensUsed + runTokens + judgeTokens,
        cacheReadTokens: (slot.goal.cacheReadTokens ?? 0) + runCacheRead,
      };
      this.commit(threadId);
      this.host.record(threadId, {
        kind: "judge_error",
        summary: `${what} failed; goal paused`,
        reason: clip(failure, REASON_MAX),
        data: { turn, tokens: judgeTokens, ...(checkError !== undefined ? { check: { command } } : {}) },
      });
      this.decide(threadId, slot.goal, "pause", `Pause: ${what} failed: ${clip(failure, 120)}`, `the ${what.toLowerCase()} could not run or answer, which is not counted as no progress`, { settleKind: kind });
      return;
    }

    const turnInfo = kind === "completed" && pending ? this.host.turnInfo?.(threadId, pending.startedAt) : undefined;
    let agentRationale: string | undefined;
    if (kind === "completed" && pending?.kind === "replan") {
      const turn = slot.goal.turns + 1;
      this.host.record(threadId, {
        kind: "replan",
        summary: pending.trigger === "stalled" ? "Replan after stalled verdict" : `Replan after ${pending.sinceReplan} turns`,
        reason: turnInfo?.rationale ? clip(turnInfo.rationale, 600) : "the model gave no rationale before its first tool call",
        ...(turnInfo?.planChanges.length ? { evidence: turnInfo.planChanges.join("; ") } : {}),
        data: { trigger: pending.trigger, turn, sinceReplan: pending.sinceReplan },
      });
    } else if (turnInfo?.rationale) {
      const firstLine = turnInfo.rationale.split("\n").find((l) => l.trim());
      if (firstLine) agentRationale = clip(firstLine, 300);
    }

    if (kind === "completed") {
      const checkData = check ? { check: { command: check.command, exitCode: check.exitCode, durationMs: check.durationMs } } : {};
      if (check?.exitCode === 0) {
        this.host.record(threadId, {
          kind: "goal_verdict",
          summary: "Check passed: goal met",
          reason: clip(verdict!.evidence, REASON_MAX),
          evidence: check.output,
          data: { verdict: { verdict: verdict!.verdict, progress: verdict!.progress }, turn: slot.goal.turns + 1, tokens: 0, ...checkData },
        });
      } else {
        this.host.record(threadId, {
          kind: "goal_verdict",
          summary: `${check ? `Check failed (exit ${check.exitCode}); ` : ""}Judge: ${verdict ? `${verdict.verdict}, progress ${verdict.progress ? "yes" : "no"}` : "unparseable reply"}`,
          reason: verdict ? clip(verdict.evidence, REASON_MAX) : "the judge reply could not be parsed; counted as no progress",
          // What the judge saw (the end of it, where the latest turn is); the check output when a check failed.
          evidence: check ? check.output : judgeSaw.slice(-2000),
          data: {
            verdict: verdict ? { verdict: verdict.verdict, progress: verdict.progress } : null,
            turn: slot.goal.turns + 1,
            tokens: judgeTokens,
            ...(judgeRaw !== undefined ? { rawReply: clip(judgeRaw, 600) } : {}),
            ...(downgraded ? { downgraded: true } : {}),
            ...checkData,
          },
        });
      }
    }

    const applied = applySettle(slot.goal, { kind, tokens: runTokens + judgeTokens, cacheRead: runCacheRead }, verdict);
    const { action } = applied;
    // A completed replan turn resets the cadence; any other completed turn counts toward the next one.
    const goal: GoalState = kind === "completed" ? { ...applied.goal, sinceReplan: pending?.kind === "replan" ? 0 : (slot.goal.sinceReplan ?? 0) + 1 } : applied.goal;
    slot.goal = goal;
    this.commit(threadId);

    let replan: ReplanTrigger | undefined;
    if (action === "continue") {
      const stalled = verdict?.verdict === "not_met" && !verdict.progress && pending?.kind !== "replan";
      if (stalled) replan = { trigger: "stalled", lastVerdict: goal.lastVerdict };
      else if (goal.replanEvery !== undefined && goal.sinceReplan >= goal.replanEvery) replan = { trigger: "cadence", lastVerdict: goal.lastVerdict };
    }
    const described = describeSettle(goal, action, kind, verdict, check ? { command: check.command, exitCode: check.exitCode } : undefined);
    this.decide(
      threadId,
      goal,
      action,
      described.summary,
      replan ? `${described.reason}; next turn is a replan checkpoint (${replan.trigger})` : described.reason,
      { settleKind: kind, ...(agentRationale ? { agentRationale } : {}), ...(replan ? { nextTurn: "replan" } : {}) },
    );
    if (action !== "continue") return;
    await this.kickoff(threadId, checkNote, replan);
  }

  private require(threadId: string): Slot {
    const slot = this.slots.get(threadId);
    if (!slot) throw new Error("This thread has no goal");
    return slot;
  }

  /** Sends the continuation if the goal is running and the thread is genuinely idle. */
  private async kickoff(threadId: string, checkNote?: string, replan?: ReplanTrigger): Promise<GoalState> {
    const slot = this.slots.get(threadId);
    if (!slot) throw new Error("This thread has no goal");
    const generation = slot.generation;
    if (slot.goal.status !== "running" || this.host.isStreaming(threadId) || this.host.hasQueued(threadId)) return slot.goal;
    try {
      const stale = () => this.slots.get(threadId) !== slot || slot.generation !== generation || slot.goal.status !== "running";
      slot.pending = {
        kind: replan ? "replan" : "continue",
        ...(replan ? { trigger: replan.trigger } : {}),
        startedAt: Date.now(),
        sinceReplan: slot.goal.sinceReplan,
      };
      const text = replan ? replanPrompt(slot.goal, replan.lastVerdict, checkNote) : continuationPrompt(slot.goal, checkNote);
      await this.host.prompt(threadId, text, stale);
      // A prompt dropped as stale never starts a turn, so nothing will settle for it.
      if (stale()) slot.pending = undefined;
    } catch (e) {
      slot.pending = undefined;
      if (this.slots.get(threadId) === slot && slot.generation === generation) {
        const message = e instanceof Error ? e.message : String(e);
        slot.goal = pause(slot.goal, message);
        this.commit(threadId);
        this.decide(threadId, slot.goal, "pause", `Pause: ${clip(message, 120)}`, "the next turn could not be started");
      }
    }
    return slot.goal;
  }

  /** Logs a goal_action: what the loop (or the user) did to the goal and the rule behind it. */
  private decide(threadId: string, goal: GoalState, action: string, summary: string, reason: string, extra: Record<string, unknown> = {}): void {
    this.host.record(threadId, { kind: "goal_action", summary, reason, data: { action, ...goalData(goal), ...extra } });
  }

  private commit(threadId: string): void {
    const goal = this.slots.get(threadId)?.goal;
    if (!goal) return;
    this.host.persist(threadId, goal);
    this.host.emit(threadId, goal);
  }
}

// ---------------------------------------------------------------------------
// Judge transcript
// ---------------------------------------------------------------------------

function lineFor(m: ChatMessage): string {
  switch (m.role) {
    case "user":
      return `USER: ${clip(m.content, 1500)}`;
    case "assistant": {
      const parts: string[] = [];
      for (const b of m.content) {
        if (b.type === "text" && b.text.trim()) parts.push(`ASSISTANT: ${clip(b.text, 2000)}`);
        else if (b.type === "toolCall") parts.push(`TOOL CALL: ${b.name} ${clip(JSON.stringify(b.arguments ?? {}), 200)}`);
      }
      return parts.join("\n");
    }
    case "toolResult":
      return `TOOL RESULT (${m.toolName}${m.isError ? ", error" : ""}): ${clip(m.content, 500)}`;
    default:
      return "";
  }
}

/** Recent user, assistant and tool lines, newest last, capped at `maxChars` (oldest dropped first). */
export function transcriptTail(messages: ChatMessage[], maxChars = TRANSCRIPT_TAIL_CHARS): string {
  const lines: string[] = [];
  let size = 0;
  for (let i = messages.length - 1; i >= 0 && size < maxChars; i--) {
    const line = lineFor(messages[i]);
    if (!line) continue;
    lines.push(line);
    size += line.length + 1;
  }
  return lines.reverse().join("\n").slice(-maxChars);
}

/** The first assistant message after the last user message: its text up to the first tool call, or "" if it has none. */
export function leadingText(messages: ChatMessage[]): string {
  let start = messages.length - 1;
  while (start >= 0 && messages[start]!.role !== "user") start--;
  const first = messages.slice(start + 1).find((m) => m.role === "assistant");
  if (!first || first.role !== "assistant") return "";
  const parts: string[] = [];
  for (const b of first.content) {
    if (b.type === "toolCall") break;
    if (b.type === "text" && b.text.trim()) parts.push(b.text.trim());
  }
  return parts.join("\n");
}

/** Billed tokens (cache reads and writes included) and the cache-read share, for assistant messages from `startIndex` on. */
export function runUsage(messages: ChatMessage[], startIndex: number): { billed: number; cacheRead: number } {
  let billed = 0;
  let cacheRead = 0;
  for (const m of messages.slice(startIndex)) {
    if (m.role !== "assistant" || !m.usage) continue;
    const t = usageTotals(m.usage);
    billed += t.billed;
    cacheRead += t.cacheRead;
  }
  return { billed, cacheRead };
}

/** Billed tokens spent by assistant messages from `startIndex` on. */
export function runTokens(messages: ChatMessage[], startIndex: number): number {
  return runUsage(messages, startIndex).billed;
}
