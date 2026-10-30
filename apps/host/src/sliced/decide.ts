import type { HostConfig } from "@pista/protocol";
import { topoOrder, type SliceBoard } from "./board.ts";

export interface SlicedConfig {
  minSlices: number;
  maxParallel: number;
  integrateTools: "read-only" | "full";
  repoSizeFraction: number;
}

/** The `sliced` settings with defaults filled in; `maxParallel` is capped at 3. */
export function resolveSlicedConfig(cfg?: HostConfig["sliced"]): SlicedConfig {
  return {
    minSlices: cfg?.minSlices ?? 3,
    maxParallel: Math.min(cfg?.maxParallel ?? 1, 3),
    integrateTools: cfg?.integrateTools ?? "full",
    repoSizeFraction: cfg?.repoSizeFraction ?? 0.5,
  };
}

export type Decision = { kind: "solo"; reason: string } | { kind: "dispatch"; waves: string[][] };

const segments = (path: string) => path.split("/").filter((s) => s && s !== ".");

/** True when one path is the other or a parent directory of it (compared by path segment, so `src/a` does not overlap `src/ab`). */
export function areasOverlap(a: string, b: string): boolean {
  const x = segments(a);
  const y = segments(b);
  const n = Math.min(x.length, y.length);
  return x.slice(0, n).every((s, i) => s === y[i]);
}

const disjoint = (a: string[], b: string[]) => !a.some((p) => b.some((q) => areasOverlap(p, q)));

/** Solo or dispatch, from the parent's slice list alone. `repoTokens` and `window` are the repo size estimate and the parent's context window. */
export function decide(board: SliceBoard, cfg: SlicedConfig, repoTokens: number, window: number): Decision {
  if (board.slices.length < cfg.minSlices) return { kind: "solo", reason: `fewer than ${cfg.minSlices} slices` };
  if (board.fitsSolo && repoTokens < window * cfg.repoSizeFraction) return { kind: "solo", reason: "small task in a small repo" };
  const byId = new Map(board.slices.map((s) => [s.id, s]));
  const waves: string[][] = [];
  for (const level of topoOrder(board.slices)) {
    const parallel = level.length > 1 && cfg.maxParallel > 1 && level.every((a, i) => level.slice(i + 1).every((b) => disjoint(byId.get(a)!.filesOrAreas, byId.get(b)!.filesOrAreas)));
    const size = parallel ? cfg.maxParallel : 1;
    for (let i = 0; i < level.length; i += size) waves.push(level.slice(i, i + size));
  }
  return { kind: "dispatch", waves };
}
