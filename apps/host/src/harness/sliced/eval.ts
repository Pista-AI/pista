import type { HarnessEval, SessionEntryLike } from "../types.ts";

interface BoardData {
  slices?: unknown[];
  phase?: string;
  status?: Record<string, string>;
}

/** Per-run counts from the last `pista.slices` board the parent persisted. */
export interface SlicedMetrics {
  /** The harness ran implementers for the slices (false when it went solo). */
  dispatched: boolean;
  slices: number;
  done: number;
  failed: number;
  skipped: number;
}

// The board kind as session.ts names it (ENTRY.slices); spelled out so this file has no import of its own beyond types.
const BOARD_KIND = "pista.slices";

const calledSlices = (entries: readonly SessionEntryLike[]) =>
  entries.some((e) => e.type === "message" && e.message?.role === "assistant" && Array.isArray(e.message.content) && e.message.content.some((p) => p.type === "toolCall" && p.name === "slices"));

/** Set only when the parent called `slices`; counts come from its last persisted board. */
function metrics(entries: readonly SessionEntryLike[]): SlicedMetrics | undefined {
  if (!calledSlices(entries)) return undefined;
  const board = entries.findLast((e) => e.type === "custom" && e.customType === BOARD_KIND)?.data as BoardData | undefined;
  const status = Object.values(board?.status ?? {});
  const count = (s: string) => status.filter((x) => x === s).length;
  const dispatched = !!board && board.phase !== "solo" && board.phase !== "plan" && status.some((x) => x !== "pending");
  return { dispatched, slices: board?.slices?.length ?? 0, done: count("done"), failed: count("failed"), skipped: count("skipped") };
}

/** Sliced-mode runs among those with metrics: how many dispatched, and slice outcomes summed over them. */
function cell(runs: readonly (Record<string, unknown> | undefined)[]): string {
  const sliced = runs.flatMap((r) => (r ? [r as unknown as SlicedMetrics] : []));
  if (!sliced.length) return "–";
  const sum = (f: (x: SlicedMetrics) => number) => sliced.reduce((a, x) => a + f(x), 0);
  return `${sliced.filter((x) => x.dispatched).length}/${sliced.length} dispatched; ${sum((x) => x.done)}/${sum((x) => x.failed)}/${sum((x) => x.skipped)} of ${sum((x) => x.slices)}`;
}

export const slicedEval: HarnessEval = {
  metrics: (entries) => metrics(entries) as unknown as Record<string, unknown> | undefined,
  column: { header: "sliced (dispatched; done/failed/skipped of slices)", cell },
};
