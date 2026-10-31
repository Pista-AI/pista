// Reference solutions for fake-model runs. A task's `fake/` folder is either flat (files that mirror the workspace) or,
// when it holds a `slices.json`, one folder per slice id; the flat view of such a task is the union of the slice folders.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { HostConfig } from "@pista/protocol";
import { topoOrder } from "../harness/sliced/board.ts";
import { resolveSlicedConfig } from "../harness/sliced/decide.ts";

export interface FakeFile {
  /** Path relative to the workspace. */
  path: string;
  content: string;
}

interface SlicesFile {
  slices: { id: string; depends_on?: string[] }[];
  fits_solo: boolean;
  reason: string;
}

const filesUnder = (dir: string): FakeFile[] =>
  existsSync(dir)
    ? // Recursive, so a reference solution can touch nested files (paths stay relative to `dir`).
      readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((f) => statSync(join(dir, f)).isFile())
        .sort()
        .map((f) => ({ path: f, content: readFileSync(join(dir, f), "utf8") }))
    : [];

/** `fake/slices.json` as the `slices` tool payload, with slice ids in dependency order; undefined when the task has none. */
export function fakeSlices(dir: string): { payload: SlicesFile; order: string[] } | undefined {
  const file = join(dir, "slices.json");
  if (!existsSync(file)) return undefined;
  const payload = JSON.parse(readFileSync(file, "utf8")) as SlicesFile;
  const asSlices = payload.slices.map((s) => ({ id: s.id, title: s.id, goal: s.id, filesOrAreas: ["x"], acceptance: "x", dependsOn: s.depends_on ?? [] }));
  return { payload, order: topoOrder(asSlices).flat() };
}

/** The files one slice writes. */
export const sliceFiles = (dir: string, id: string): FakeFile[] => filesUnder(join(dir, id));

/** Every file of the reference solution: the flat folder, or the union of the slice folders when the task has `slices.json`. */
export function fakeFiles(dir: string): FakeFile[] {
  const sliced = fakeSlices(dir);
  return sliced ? sliced.order.flatMap((id) => sliceFiles(dir, id)) : filesUnder(dir);
}

/** The scripted reply a fake implementer ends with: the sectioned report the parent reads. */
export const fakeReport = (id: string, files: FakeFile[]) => `## Changed\n${files.map((f) => `- ${f.path}`).join("\n") || "- nothing"} (slice ${id})\n\n## Ran\nnode --test\n\n## Assumptions\nnone\n\n## Open questions\nnone`;

/** True when the fake script should drive sliced mode: the preset asks for it and the task ships `slices.json`. Throws for settings the global fake queue cannot serve. */
export function slicedFake(config: Partial<HostConfig>, dir: string): boolean {
  if (config.orchestratorMode !== "sliced" || !existsSync(join(dir, "slices.json"))) return false;
  if (resolveSlicedConfig(config.sliced).maxParallel !== 1) throw new Error("fake sliced runs need sliced.maxParallel 1: the fake model's reply queue is global, so parallel children would consume each other's replies");
  return true;
}

/** Whether the harness would run this fake task solo because it has too few slices. */
export const fakeFallsBackToSolo = (config: Partial<HostConfig>, slices: SlicesFile): boolean => slices.slices.length < resolveSlicedConfig(config.sliced).minSlices;
