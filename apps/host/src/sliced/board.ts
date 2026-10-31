/** One unit of work the parent proposes through the `slices` tool; the harness runs one implementer child per slice. */
export interface Slice {
  id: string;
  title: string;
  goal: string;
  /** Paths or directories the slice touches; slices with disjoint areas may run in parallel. */
  filesOrAreas: string[];
  acceptance: string;
  dependsOn: string[];
}

export type SliceStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface SliceBoard {
  slices: Slice[];
  /** The parent's own claim that the whole task is small enough to do alone. */
  fitsSolo: boolean;
  reason: string;
  phase: "plan" | "solo" | "dispatch" | "integrate" | "done";
  status: Record<string, SliceStatus>;
  /** How often the harness has had to remind the parent to call `slices`. */
  nudges: number;
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

/** Checks the parent's slice list: unique ids, known dependencies without cycles, and areas and acceptance on every slice. */
export function validateSlices(input: unknown): { ok: true; slices: Slice[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: "slices must be a non-empty array" };
  const slices: Slice[] = [];
  const ids = new Set<string>();
  for (const [i, raw] of input.entries()) {
    const s = raw as Partial<Slice> | null;
    if (!s || typeof s !== "object") return { ok: false, error: `slice ${i + 1} must be an object` };
    if (!nonEmpty(s.id)) return { ok: false, error: `slice ${i + 1} needs a non-empty id` };
    if (ids.has(s.id)) return { ok: false, error: `duplicate slice id "${s.id}"` };
    ids.add(s.id);
    if (!nonEmpty(s.title) || !nonEmpty(s.goal)) return { ok: false, error: `slice "${s.id}" needs a title and a goal` };
    if (!strings(s.filesOrAreas) || s.filesOrAreas.length === 0 || !s.filesOrAreas.every((p) => nonEmpty(p) && p.split("/").some((seg) => seg && seg !== "."))) return { ok: false, error: `slice "${s.id}" needs a non-empty filesOrAreas list` };
    if (!nonEmpty(s.acceptance)) return { ok: false, error: `slice "${s.id}" needs a non-empty acceptance` };
    if (s.dependsOn !== undefined && !strings(s.dependsOn)) return { ok: false, error: `slice "${s.id}": dependsOn must be a list of slice ids` };
    slices.push({ id: s.id, title: s.title, goal: s.goal, filesOrAreas: s.filesOrAreas, acceptance: s.acceptance, dependsOn: s.dependsOn ?? [] });
  }
  for (const s of slices) {
    const unknown = s.dependsOn.find((d) => !ids.has(d) || d === s.id);
    if (unknown !== undefined) return { ok: false, error: `slice "${s.id}" depends on ${unknown === s.id ? "itself" : `unknown slice "${unknown}"`}` };
  }
  if (levels(slices).flat().length < slices.length) return { ok: false, error: "slices have a dependency cycle" };
  return { ok: true, slices };
}

/** Kahn levels; slices in a cycle are left out. */
function levels(slices: Slice[]): string[][] {
  const done = new Set<string>();
  const out: string[][] = [];
  let rest = slices;
  while (rest.length) {
    const ready = rest.filter((s) => s.dependsOn.every((d) => done.has(d)));
    if (ready.length === 0) break;
    out.push(ready.map((s) => s.id));
    for (const s of ready) done.add(s.id);
    rest = rest.filter((s) => !done.has(s.id));
  }
  return out;
}

/** Slice ids grouped into dependency levels, in the order given. Everything in a level depends only on earlier levels. */
export const topoOrder = (slices: Slice[]): string[][] => levels(slices);
