import type { SliceBoard } from "./board.ts";

/** One compact line per slice, e.g. `s1 done  Title (acceptance)`; about 25 tokens each. */
export function renderBoard(board: SliceBoard): string {
  return board.slices.map((s) => `${s.id} ${(board.status[s.id] ?? "pending").padEnd(7)} ${s.title} (${s.acceptance})`).join("\n");
}
