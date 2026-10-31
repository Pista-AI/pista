import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentOutcome, AgentToolParams } from "../subagent.ts";
import type { Slice, SliceBoard } from "./board.ts";
import { briefProblem, composeBrief } from "../brief.ts";
import { PREREAD_FILE_CHARS, PREREAD_TOTAL_CHARS, prereadSection } from "./preread.ts";
import { REQUEST_CHARS, capRequest, runSchedule } from "./schedule.ts";

const cwd = process.cwd();

const slice = (id: string, dependsOn: string[] = []): Slice => ({ id, title: `Title ${id}`, goal: `goal ${id}`, filesOrAreas: [`src/${id}`], acceptance: "pnpm test", dependsOn });
const boardOf = (slices: Slice[]): SliceBoard => ({ slices, fitsSolo: false, reason: "r", phase: "dispatch", status: Object.fromEntries(slices.map((s) => [s.id, "pending" as const])), nudges: 0 });
const outcome = (over: Partial<AgentOutcome> = {}): { outcome: AgentOutcome } => ({ outcome: { verify: "passed", report: "ok", threadId: "t", aborted: false, ...over } });

test("sequential waves run in order and every transition is persisted", async () => {
  const started: string[] = [];
  const saved: string[] = [];
  const updates: string[] = [];
  const { board, results } = await runSchedule({
    cwd, board: boardOf([slice("a"), slice("b", ["a"])]),
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
  let bothStartedNow!: () => void;
  const bothStarted = new Promise<void>((r) => (bothStartedNow = r));
  const run = runSchedule({
    cwd, board: boardOf([slice("a"), slice("b")]),
    waves: [["a", "b"]],
    runAgent: (p) => {
      started.push(p.goal);
      if (started.length === 2) bothStartedNow();
      return new Promise((resolve) => release.push(() => resolve(outcome())));
    },
    persist: () => {},
  });
  await bothStarted;
  assert.equal(started.length, 2);
  release.forEach((r) => r());
  assert.deepEqual((await run).board.status, { a: "done", b: "done" });
});

test("dependents of a failed slice are skipped with a reason; independent slices still run", async () => {
  const started: string[] = [];
  const { board, results } = await runSchedule({
    cwd, board: boardOf([slice("a"), slice("b", ["a"]), slice("c", ["b"]), slice("d")]),
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
    cwd, board: boardOf([slice("a"), slice("b"), slice("c")]),
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
    cwd, board: boardOf([slice("a"), slice("b"), slice("c")]),
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

test("the child brief carries the pointer files and directories read by the harness, after the composed brief", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sliced-preread-"));
  mkdirSync(join(dir, "src/sub"), { recursive: true });
  writeFileSync(join(dir, "src/x.ts"), "export const x = 1;\n");
  writeFileSync(join(dir, "src/sub/y.ts"), "y");
  writeFileSync(join(dir, "src/big.ts"), "a".repeat(PREREAD_FILE_CHARS + 500));
  writeFileSync(join(dir, "src/bin.dat"), Buffer.from([1, 2, 0, 3]));
  const outside = mkdtempSync(join(tmpdir(), "sliced-outside-"));
  writeFileSync(join(outside, "secret.txt"), "TOPSECRET");
  let brief = "";
  let params: AgentToolParams | undefined;
  const s: Slice = { ...slice("a"), filesOrAreas: ["src/x.ts", "src", "src/big.ts", "src/bin.dat", "src/missing.ts", join(outside, "secret.txt"), "../escape.txt"] };
  await runSchedule({
    cwd: dir,
    board: boardOf([s]),
    waves: [["a"]],
    runAgent: async (p) => {
      params = p;
      brief = composeBrief(p);
      return outcome();
    },
    persist: () => {},
  });
  assert.match(brief, /## Files read by the harness/);
  assert.ok(brief.indexOf("## Files read by the harness") > brief.indexOf("## Constraints"), "appended after the composed brief");
  assert.match(brief, /```path=src\/x\.ts\nexport const x = 1;/);
  assert.match(brief, /```path=src\/ \(directory\)\n[\s\S]*sub\/[\s\S]*x\.ts/);
  assert.match(brief, /\[truncated: file is \d+ bytes\]/);
  assert.doesNotMatch(brief, /path=src\/bin\.dat/, "binary skipped");
  const attached = brief.slice(brief.indexOf("## Files read by the harness"));
  assert.doesNotMatch(attached, /TOPSECRET|secret\.txt|escape/, "outside cwd skipped");
  assert.match(brief, /Start from the files above; do not list or grep the repository before you have read them\./);
  assert.equal(params?.pointers?.length, 7, "pointers field is unchanged");
});

test("the brief has no pre-read section when no pointer can be read", async () => {
  let brief = "";
  await runSchedule({ cwd, board: boardOf([slice("a")]), waves: [["a"]], runAgent: async (p) => ((brief = composeBrief(p)), outcome()), persist: () => {} });
  assert.doesNotMatch(brief, /Files read by the harness/);
});

test("the original request appears verbatim under the slice goal in every child brief", async () => {
  const briefs: string[] = [];
  await runSchedule({
    cwd,
    board: { ...boardOf([slice("a"), slice("b")]), request: "Rename foo to bar.\nKeep the tests green." },
    waves: [["a", "b"]],
    runAgent: async (p) => ((briefs.push(composeBrief(p)), outcome())),
    persist: () => {},
  });
  assert.equal(briefs.length, 2);
  for (const b of briefs) assert.match(b, /## Original request\nRename foo to bar\.\nKeep the tests green\.\n\n## Goal\ngoal [ab]/);
});

test("a request with code fences does not trip briefProblem and still reaches the brief", async () => {
  const request = "Fix this:\n```ts\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```";
  let params: AgentToolParams | undefined;
  await runSchedule({ cwd, board: { ...boardOf([slice("a")]), request }, waves: [["a"]], runAgent: async (p) => ((params = p), outcome()), persist: () => {} });
  assert.equal(briefProblem({ goal: params!.goal, constraints: params!.constraints, pointers: params!.pointers }), undefined);
  assert.match(composeBrief(params!), /## Original request\nFix this:\n```ts/);
});

test("a symlink inside cwd that points outside is not read", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sliced-link-"));
  const outside = mkdtempSync(join(tmpdir(), "sliced-linkout-"));
  writeFileSync(join(outside, "secret.txt"), "TOPSECRET");
  symlinkSync(join(outside, "secret.txt"), join(dir, "link.txt"));
  symlinkSync(outside, join(dir, "linkdir"));
  assert.equal(await prereadSection(dir, ["link.txt", "linkdir"]), undefined);
});

test("the pre-read section stays under the total cap and says how many pointers were dropped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sliced-cap-"));
  const names = Array.from({ length: 8 }, (_, i) => `f${i}.txt`);
  for (const n of names) writeFileSync(join(dir, n), "x".repeat(PREREAD_FILE_CHARS * 2));
  const section = (await prereadSection(dir, names))!;
  assert.ok(section.length <= PREREAD_TOTAL_CHARS, `${section.length}`);
  assert.match(section, /\[\d+ pointers omitted: budget\]/);
});

test("capRequest cuts a request over the cap and marks it", () => {
  const long = "r".repeat(REQUEST_CHARS + 100);
  const out = capRequest(long);
  assert.equal(out, `${"r".repeat(REQUEST_CHARS)}\n[truncated]`);
  assert.equal(capRequest("short"), "short");
});

test("a runner that throws inside a parallel wave leaves the sibling done", async () => {
  const { board } = await runSchedule({
    cwd, board: boardOf([slice("a"), slice("b")]),
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
    cwd, board: boardOf([slice("a")]),
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
    cwd, board: boardOf([slice("a"), slice("b"), slice("c")]),
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
