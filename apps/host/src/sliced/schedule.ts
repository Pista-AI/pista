import type { AgentOutcome, AgentToolParams } from "../subagent.ts";
import type { SliceBoard } from "./board.ts";
import { prereadSection } from "./preread.ts";
import { renderBoard } from "./render.ts";

/** The part of the agent runner the scheduler needs; tests stub it. */
export type SliceRunner = (params: AgentToolParams, signal?: AbortSignal) => Promise<{ outcome: AgentOutcome }>;

export interface SliceResult {
  verify: AgentOutcome["verify"];
  report: string;
  threadId?: string;
  /** Shown beside the status, e.g. "verify failed after 2 attempts (pnpm test)" or "unverified: no edits". */
  note?: string;
}

export interface ScheduleParams {
  board: SliceBoard;
  /** Working directory the slices' pointers resolve against. */
  cwd: string;
  /** Ids per wave, from `decide`; slices in one wave run concurrently. */
  waves: string[][];
  runAgent: SliceRunner;
  /** Called after every status change with the updated board. */
  persist: (board: SliceBoard) => void;
  signal?: AbortSignal;
  onUpdate?: (line: string) => void;
}

const STANDARD_CONSTRAINTS = "Read the code before deciding details; follow the conventions of neighbouring code; state assumptions in your report. Stay inside this slice's files unless the acceptance command needs more.";

/** Longest user request copied into a child brief. */
export const REQUEST_CHARS = 6000;

/** The user's request capped for the board, with a marker when cut. */
export const capRequest = (text: string): string => (text.length > REQUEST_CHARS ? `${text.slice(0, REQUEST_CHARS)}\n[truncated]` : text);

/**
 * Runs the waves in order with one implementer child per slice. Slices of a parallel wave share one working tree, and the
 * verify gate runs inside `runAgent`, so slice A's verify can see slice B's half-written edits and fail for that reason.
 * That is why `maxParallel` defaults to 1; splitting run and verify would need a runner API that separates them. A slice that depends on a failed or skipped one is skipped; a failed slice does not stop independent ones. */
export async function runSchedule(params: ScheduleParams): Promise<{ board: SliceBoard; results: Record<string, SliceResult> }> {
  const { waves, runAgent, persist, signal, onUpdate, cwd } = params;
  let board = params.board;
  const results: Record<string, SliceResult> = {};
  const total = board.slices.length;
  const set = (id: string, status: SliceBoard["status"][string]) => {
    board = { ...board, status: { ...board.status, [id]: status } };
    persist(board);
  };
  const finished = () => Object.values(board.status).filter((s) => s === "done" || s === "failed" || s === "skipped").length;
  const skip = (id: string, reason: string) => {
    results[id] = { verify: "none", report: `Skipped: ${reason}` };
    set(id, "skipped");
    onUpdate?.(`slice ${id} skipped: ${reason} (${finished()}/${total})`);
  };
  const byId = new Map(board.slices.map((s) => [s.id, s]));

  const runSlice = async (id: string) => {
    const slice = byId.get(id)!;
    set(id, "running");
    let result: SliceResult;
    let failed: boolean;
    try {
      const attachments = await prereadSection(cwd, slice.filesOrAreas);
      const { outcome } = await runAgent(
        { role: "implementer", goal: slice.goal, context: board.request, pointers: slice.filesOrAreas, acceptance: slice.acceptance, constraints: `${STANDARD_CONSTRAINTS}\n\nSlice board:\n${renderBoard(board)}`, attachments },
        signal,
      );
      failed = outcome.verify === "failed" || outcome.aborted;
      const note = outcome.verifyNote ? `verify ${outcome.verifyNote}` : outcome.verify === "none" && !outcome.edited && !failed ? "unverified: no edits" : undefined;
      result = { verify: outcome.verify, report: outcome.report, threadId: outcome.threadId, ...(note ? { note } : {}) };
    } catch (error) {
      result = { verify: "none", report: `Error: ${error instanceof Error ? error.message : String(error)}` };
      failed = true;
    }
    results[id] = result;
    const status = failed ? "failed" : "done";
    set(id, status);
    onUpdate?.(`slice ${id} ${status} (${finished()}/${total})`);
  };

  for (const wave of waves) {
    const runnable: string[] = [];
    for (const id of wave) {
      if (signal?.aborted) skip(id, "aborted");
      else {
        const blocker = byId.get(id)!.dependsOn.find((d) => board.status[d] === "failed" || board.status[d] === "skipped");
        if (blocker) skip(id, `depends on ${blocker}, which ${board.status[blocker]}`);
        else runnable.push(id);
      }
    }
    await Promise.all(runnable.map(runSlice));
  }
  return { board, results };
}
