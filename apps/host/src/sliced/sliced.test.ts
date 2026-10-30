import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { topoOrder, validateSlices, type Slice, type SliceBoard } from "./board.ts";
import { areasOverlap, decide, resolveSlicedConfig } from "./decide.ts";
import { estimateRepoTokens } from "./estimate.ts";
import { renderBoard } from "./render.ts";

const slice = (id: string, areas: string[] = [`src/${id}`], dependsOn: string[] = []): Slice => ({ id, title: `Title ${id}`, goal: "g", filesOrAreas: areas, acceptance: "tests pass", dependsOn });
const board = (slices: Slice[], fitsSolo = false): SliceBoard => ({ slices, fitsSolo, reason: "", phase: "plan", status: {}, nudges: 0 });
const cfg = (over: Parameters<typeof resolveSlicedConfig>[0] = {}) => resolveSlicedConfig({ minSlices: 2, ...over });

test("validateSlices accepts a good list and defaults dependsOn", () => {
  const { dependsOn: _, ...bare } = slice("a");
  const r = validateSlices([bare, slice("b", ["x"], ["a"])]);
  assert.ok(r.ok);
  assert.deepEqual(r.slices[0]!.dependsOn, []);
});

test("validateSlices rejects bad lists", () => {
  const bad = (input: unknown, pattern: RegExp) => {
    const r = validateSlices(input);
    assert.ok(!r.ok);
    assert.match(r.error, pattern);
  };
  bad([], /non-empty array/);
  bad([slice("a"), slice("a")], /duplicate/);
  bad([slice("")], /id/);
  bad([slice("a", [], [])], /filesOrAreas/);
  bad([{ ...slice("a"), acceptance: " " }], /acceptance/);
  for (const area of ["", ".", "/", "./"]) bad([slice("a", [area])], /filesOrAreas/);
  bad([slice("a", ["x"], ["nope"])], /unknown slice "nope"/);
  bad([slice("a", ["x"], ["a"])], /itself/);
  bad([slice("a", ["x"], ["b"]), slice("b", ["y"], ["a"])], /cycle/);
});

test("topoOrder groups slices into levels", () => {
  assert.deepEqual(topoOrder([slice("a"), slice("b"), slice("c", ["c"], ["a", "b"]), slice("d", ["d"], ["c"])]), [["a", "b"], ["c"], ["d"]]);
});

test("areasOverlap compares whole path segments", () => {
  assert.ok(areasOverlap("src", "src/a.ts"));
  assert.ok(areasOverlap("src/a/", "src/a"));
  assert.ok(!areasOverlap("src/a", "src/ab"));
  assert.ok(!areasOverlap("a.ts", "b.ts"));
});

test("resolveSlicedConfig fills defaults and caps maxParallel", () => {
  assert.deepEqual(resolveSlicedConfig(), { minSlices: 3, maxParallel: 1, integrateTools: "full", repoSizeFraction: 0.5 });
  assert.equal(resolveSlicedConfig({ maxParallel: 9 }).maxParallel, 3);
});

test("decide runs solo below minSlices and for a small task in a small repo", () => {
  assert.equal(decide(board([slice("a")]), cfg(), 1e9, 100).kind, "solo");
  assert.equal(decide(board([slice("a"), slice("b")], true), cfg(), 49, 100).kind, "solo");
  assert.equal(decide(board([slice("a"), slice("b")], true), cfg(), 50, 100).kind, "dispatch");
  assert.equal(decide(board([slice("a"), slice("b")], false), cfg(), 1, 100).kind, "dispatch");
});

test("decide runs disjoint slices in parallel only when allowed, capped at maxParallel", () => {
  const four = board([slice("a"), slice("b"), slice("c"), slice("d")]);
  const waves = (maxParallel: number) => (decide(four, cfg({ maxParallel }), 1, 100) as { waves: string[][] }).waves;
  assert.deepEqual(waves(1), [["a"], ["b"], ["c"], ["d"]]);
  assert.deepEqual(waves(2), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(waves(3), [["a", "b", "c"], ["d"]]);
});

test("decide serialises a level whose areas overlap and keeps dependency order", () => {
  const overlapping = board([slice("a", ["src"]), slice("b", ["src/x.ts"]), slice("c", ["docs"])]);
  assert.deepEqual((decide(overlapping, cfg({ maxParallel: 3 }), 1, 100) as { waves: string[][] }).waves, [["a"], ["b"], ["c"]]);
  const chain = board([slice("a"), slice("b", ["src/b"], ["a"])]);
  assert.deepEqual((decide(chain, cfg({ maxParallel: 3 }), 1, 100) as { waves: string[][] }).waves, [["a"], ["b"]]);
});

test("renderBoard prints one line per slice", () => {
  const b = board([slice("s1"), slice("s2")]);
  b.status = { s1: "done" };
  assert.equal(renderBoard(b), "s1 done    Title s1 (tests pass)\ns2 pending Title s2 (tests pass)");
});

test("estimateRepoTokens counts text bytes with and without git", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pista-est-"));
  try {
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "src", "a.ts"), "x".repeat(4000));
    writeFileSync(join(dir, "big.txt"), "x".repeat(2 * 1024 * 1024));
    writeFileSync(join(dir, "logo.png"), "x".repeat(4000));
    writeFileSync(join(dir, "node_modules", "dep.js"), "x".repeat(4000));
    const expected = 1000 + 262144; // the 2 MB file counts as 1 MB; the png and node_modules do not
    assert.equal(await estimateRepoTokens(dir), expected); // walk fallback: not a git repo
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["add", "src", "big.txt", "logo.png"], { cwd: dir });
    assert.equal(await estimateRepoTokens(dir), expected); // tracked files only
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
