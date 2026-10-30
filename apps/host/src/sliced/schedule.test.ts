import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentOutcome, AgentToolParams } from "../subagent.ts";
import type { Slice, SliceBoard } from "./board.ts";
import { runSchedule } from "./schedule.ts";

const slice = (id: string, dependsOn: string[] = []): Slice => ({ id, title: `Title ${id}`, goal: `goal ${id}`, filesOrAreas: [`src/${id}`], acceptance: "pnpm test", dependsOn });
const boardOf = (slices: Slice[]): SliceBoard => ({ slices, fitsSolo: false, reason: "r", phase: "dispatch", status: Object.fromEntries(slices.map((s) => [s.id, "pending" as const])), nudges: 0 });
const outcome = (over: Partial<AgentOutcome> = {}): { outcome: AgentOutcome } => ({ outcome: { verify: "passed", report: "ok", threadId: "t", aborted: false, ...over } });

test("sequential waves run in order and every transition is persisted", async () => {
  const started: string[] = [];
  const saved: string[] = [];
  const updates: string[] = [];
  const { board, results } = await runSchedule({
    board: boardOf([slice("a"), slice("b", ["a"])]),
    waves: [["a"], ["b"]],
    runAgent: async (p: AgentToolParams) => {
      started.push(p.goal);
      assert.equal(p.role, "implementer");
      assert.deepEqual(p.pointers, [`src/${p.goal.slice(-1)}`]);
      assert.match(p.constraints ?? "", /Slice board:\n[\s\S]*running/);
      return outcome({ report: `report ${p.goal}` });
    },
    persist: (b) => saved.push(JSON.stringify(b.status)),
    onUpdate: (l) => updates.push(l),
  });
  assert.deepEqual(started, ["goal a", "goal b"]);
  assert.deepEqual(board.status, { a: "done", b: "done" });
  assert.equal(results.b?.report, "report goal b");
  assert.equal(saved.length, 4);
  assert.deepEqual(updates, ["slice a done (1/2)", "slice b done (2/2)"]);
});

test("a parallel wave starts both slices before either finishes", async () => {
  const started: string[] = [];
  const release: (() => void)[] = [];
  const run = runSchedule({
    board: boardOf([slice("a"), slice("b")]),
    waves: [["a", "b"]],
    runAgent: (p) => {
      started.push(p.goal);
      return new Promise((resolve) => release.push(() => resolve(outcome())));
    },
    persist: () => {},
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(started.length, 2);
  release.forEach((r) => r());
  assert.deepEqual((await run).board.status, { a: "done", b: "done" });
});

test("dependents of a failed slice are skipped with a reason; independent slices still run", async () => {
  const started: string[] = [];
  const { board, results } = await runSchedule({
    board: boardOf([slice("a"), slice("b", ["a"]), slice("c", ["b"]), slice("d")]),
    waves: [["a"], ["d"], ["b"], ["c"]],
    runAgent: async (p) => {
      started.push(p.goal);
      return outcome(p.goal === "goal a" ? { verify: "failed", report: "broke" } : {});
    },
    persist: () => {},
  });
  assert.deepEqual(started, ["goal a", "goal d"]);
  assert.deepEqual(board.status, { a: "failed", b: "skipped", c: "skipped", d: "done" });
  assert.match(results.b!.report, /depends on a, which failed/);
  assert.match(results.c!.report, /depends on b, which skipped/);
});

test("a failed verify does not stop later independent slices, and a thrown error fails the slice", async () => {
  const { board, results } = await runSchedule({
    board: boardOf([slice("a"), slice("b"), slice("c")]),
    waves: [["a"], ["b"], ["c"]],
    runAgent: async (p) => {
      if (p.goal === "goal b") throw new Error("timed out");
      return outcome(p.goal === "goal a" ? { verify: "failed" } : {});
    },
    persist: () => {},
  });
  assert.deepEqual(board.status, { a: "failed", b: "failed", c: "done" });
  assert.match(results.b!.report, /timed out/);
});

test("abort mid-way fails the running slice and skips the rest", async () => {
  const ac = new AbortController();
  const { board, results } = await runSchedule({
    board: boardOf([slice("a"), slice("b"), slice("c")]),
    waves: [["a"], ["b"], ["c"]],
    runAgent: async () => {
      ac.abort();
      return outcome({ aborted: true, verify: "none" });
    },
    persist: () => {},
    signal: ac.signal,
  });
  assert.deepEqual(board.status, { a: "failed", b: "skipped", c: "skipped" });
  assert.match(results.b!.report, /aborted/);
});

test("a runner that throws inside a parallel wave leaves the sibling done", async () => {
  const { board } = await runSchedule({
    board: boardOf([slice("a"), slice("b")]),
    waves: [["a", "b"]],
    runAgent: async (p) => {
      if (p.goal === "goal a") throw new Error("boom");
      return outcome({ edited: true });
    },
    persist: () => {},
  });
  assert.deepEqual(board.status, { a: "failed", b: "done" });
});

test("the abort signal is passed to the runner", async () => {
  const ac = new AbortController();
  let seen: AbortSignal | undefined;
  await runSchedule({
    board: boardOf([slice("a")]),
    waves: [["a"]],
    runAgent: async (_p, signal) => {
      seen = signal;
      return outcome();
    },
    persist: () => {},
    signal: ac.signal,
  });
  assert.equal(seen, ac.signal);
});

test("notes carry the verify line, and an unedited unverified slice is flagged", async () => {
  const { results } = await runSchedule({
    board: boardOf([slice("a"), slice("b"), slice("c")]),
    waves: [["a"], ["b"], ["c"]],
    runAgent: async (p) => {
      if (p.goal === "goal a") return outcome({ verify: "failed", verifyNote: "failed after 2 attempts (pnpm test)", edited: true });
      if (p.goal === "goal b") return outcome({ verify: "none", edited: false });
      return outcome({ verify: "passed", edited: true });
    },
    persist: () => {},
  });
  assert.equal(results.a?.note, "verify failed after 2 attempts (pnpm test)");
  assert.equal(results.b?.note, "unverified: no edits");
  assert.equal(results.c?.note, undefined);
});
