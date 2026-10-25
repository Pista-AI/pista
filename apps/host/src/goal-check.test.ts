import assert from "node:assert/strict";
import { test } from "node:test";
import type { DecisionEntry } from "@pista/protocol";
import { GoalRunner, type CheckOutcome } from "./goal-runner.ts";
import { capOutput, CHECK_OUTPUT_CHARS, type Verdict } from "./goal.ts";
import { liveOf, makeManager, setupHome } from "./test-helpers.ts";

const { projectDir } = setupHome("goalcheck");

const MET: Verdict = { verdict: "met", progress: true, evidence: "looks done" };
const PROGRESS: Verdict = { verdict: "not_met", progress: true, evidence: "closer" };

function harness(verdicts: Verdict[], check: () => Promise<CheckOutcome>) {
  const prompts: string[] = [];
  const judged: string[] = [];
  const decisions: Omit<DecisionEntry, "id" | "ts">[] = [];
  const runner = new GoalRunner(
    {
      isStreaming: () => false,
      hasQueued: () => false,
      prompt: async (_id, text) => void prompts.push(text),
      transcriptTail: () => "tail",
      persist: () => {},
      emit: () => {},
      record: (_id, entry) => void decisions.push(entry),
    },
    async (_goal, tail) => (judged.push(tail), { verdict: verdicts.shift(), tokens: 5 }),
    async () => check(),
  );
  return { runner, prompts, judged, decisions };
}

test("capOutput keeps the head and tail within the cap and leaves short output alone", () => {
  assert.equal(capOutput("short"), "short");
  const long = `HEAD${"x".repeat(10_000)}TAIL`;
  const capped = capOutput(long);
  assert.ok(capped.length <= CHECK_OUTPUT_CHARS);
  assert.ok(capped.startsWith("HEAD"));
  assert.ok(capped.endsWith("TAIL"));
  assert.match(capped, /truncated/);
});

test("check exit 0: goal met without calling the judge; the decision carries the check", async () => {
  const h = harness([], async () => ({ exitCode: 0, output: "all green", durationMs: 12 }));
  const goal = await h.runner.set("t", "make tests pass", { check: " pnpm test " });
  assert.equal(goal.check, "pnpm test");
  await h.runner.onSettle("t", "completed", 100);
  assert.equal(h.runner.get("t")!.status, "met");
  assert.equal(h.judged.length, 0);
  assert.equal(h.prompts.length, 1);
  const verdict = h.decisions.find((d) => d.kind === "goal_verdict")!;
  assert.deepEqual(verdict.data?.check, { command: "pnpm test", exitCode: 0, durationMs: 12 });
  assert.equal(verdict.evidence, "all green");
  assert.match(verdict.reason ?? "", /check passed: pnpm test/);
  assert.equal(h.decisions.filter((d) => d.kind === "goal_action").at(-1)?.data?.action, "stop");
});

test("check exit 1 with a judge that says met: not met, progress per judge, continuation shows the output", async () => {
  const h = harness([MET], async () => ({ exitCode: 1, output: "FAIL: 2 tests", durationMs: 5 }));
  await h.runner.set("t", "g", { check: "pnpm test" });
  await h.runner.onSettle("t", "completed", 100);
  const goal = h.runner.get("t")!;
  assert.equal(goal.status, "running");
  assert.equal(goal.noProgressTurns, 0);
  assert.equal(h.judged.length, 1);
  assert.match(h.judged[0], /Acceptance check failed \(exit 1\)/);
  assert.match(h.judged[0], /FAIL: 2 tests/);
  assert.equal(h.prompts.length, 2);
  assert.match(h.prompts[1], /Acceptance check failed \(exit 1\)/);
  assert.match(h.prompts[1], /FAIL: 2 tests/);
  const verdict = h.decisions.find((d) => d.kind === "goal_verdict")!;
  assert.equal((verdict.data?.verdict as Verdict).verdict, "not_met");
  assert.equal(verdict.data?.downgraded, true);
  assert.equal((verdict.data?.check as { exitCode: number }).exitCode, 1);
});

test("a failing check with a judge that sees no progress still counts toward the no-progress limit", async () => {
  const h = harness([{ verdict: "not_met", progress: false, evidence: "stuck" }], async () => ({ exitCode: 2, output: "x", durationMs: 1 }));
  await h.runner.set("t", "g", { check: "false" });
  await h.runner.onSettle("t", "completed", 1);
  assert.equal(h.runner.get("t")!.noProgressTurns, 1);
});

test("a check that cannot run pauses the goal with a judge_error and does not call the judge", async () => {
  const h = harness([PROGRESS], async () => {
    throw new Error("Timed out after 120 s");
  });
  await h.runner.set("t", "g", { check: "sleep 999" });
  await h.runner.onSettle("t", "completed", 10);
  const goal = h.runner.get("t")!;
  assert.equal(goal.status, "paused");
  assert.match(goal.pausedReason ?? "", /Acceptance check failed: Timed out/);
  assert.equal(h.judged.length, 0);
  assert.equal(h.prompts.length, 1);
  const err = h.decisions.find((d) => d.kind === "judge_error")!;
  assert.match(err.reason ?? "", /Timed out/);
});

test("a skipped check (read-only mode) is logged and the model judge decides as before", async () => {
  const h = harness([MET], async () => ({ skipped: "Read-only mode blocks running commands" }));
  await h.runner.set("t", "g", { check: "pnpm test" });
  await h.runner.onSettle("t", "completed", 1);
  assert.equal(h.judged.length, 1);
  assert.equal(h.runner.get("t")!.status, "met");
  assert.equal(h.decisions.filter((d) => d.kind === "judge_error").length, 1);
});

test("a goal without a check never runs one", async () => {
  let ran = 0;
  const h = harness([MET], async () => (ran++, { exitCode: 0, output: "", durationMs: 0 }));
  await h.runner.set("t", "g");
  await h.runner.onSettle("t", "completed", 1);
  assert.equal(ran, 0);
  assert.equal(h.judged.length, 1);
});

// -- Real execution through the session's bash path --------------------------------------

test("ThreadManager runs the check through the real bash path, honouring the approval mode", async () => {
  const verdicts: Verdict[] = [PROGRESS];
  let judgeCalls = 0;
  const { manager, store, project } = await makeManager({
    projectDir,
    goalJudge: async () => (judgeCalls++, { verdict: verdicts.shift(), tokens: 1 }),
  });
  const priv = manager as unknown as {
    send: (id: string, text: string) => Promise<{ run: Promise<void> }>;
    onEvent: (thread: unknown, event: unknown) => void;
    runGoalCheck: (id: string, command: string) => Promise<{ exitCode?: number; output?: string; skipped?: string }>;
  };
  const sent: string[] = [];
  priv.send = async (_id, text) => (sent.push(text), { run: Promise.resolve() });
  const snap = await manager.create(project.id);
  const id = snap.summary.id;
  const thread = liveOf<object>(manager).get(id)!;

  store.config.approvalMode = "read-only";
  assert.match((await priv.runGoalCheck(id, "exit 0")).skipped ?? "", /Read-only/);

  store.config.approvalMode = "full-access";
  const three = await priv.runGoalCheck(id, "echo out; echo err >&2; exit 3");
  assert.equal(three.exitCode, 3);
  assert.match(three.output ?? "", /out/);
  assert.match(three.output ?? "", /err/);

  await manager.goalSet(id, "ship it", { check: "exit 3" });
  priv.onEvent(thread, { type: "agent_start" });
  priv.onEvent(thread, { type: "agent_settled" });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(judgeCalls, 1);
  assert.equal(sent.length, 2);
  assert.match(sent[1], /Acceptance check failed \(exit 3\)/);

  await manager.goalSet(id, "ship it", { check: "exit 0" });
  priv.onEvent(thread, { type: "agent_start" });
  priv.onEvent(thread, { type: "agent_settled" });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(judgeCalls, 1);
  assert.equal((await manager.open(id)).goal?.status, "met");
});

test("ask mode: a decline pauses the goal with the reason; always-allow is remembered; a goal cleared during approval never executes", async () => {
  const { manager, store, hub, project } = await makeManager({ projectDir, goalJudge: async () => ({ verdict: PROGRESS, tokens: 1 }) });
  const priv = manager as unknown as {
    send: (id: string, text: string) => Promise<{ run: Promise<void> }>;
    onEvent: (thread: unknown, event: unknown) => void;
  };
  priv.send = async () => ({ run: Promise.resolve() });
  const snap = await manager.create(project.id);
  const id = snap.summary.id;
  const live = liveOf<{ session: { executeBash: (...a: unknown[]) => Promise<unknown> }; alwaysAllowed: Set<string> }>(manager).get(id)!;
  let executed = 0;
  live.session.executeBash = async () => (executed++, { output: "", exitCode: 0, cancelled: false, truncated: false });
  const settle = async () => {
    priv.onEvent(live, { type: "agent_start" });
    priv.onEvent(live, { type: "agent_settled" });
    await new Promise((r) => setTimeout(r, 50));
  };
  store.config.approvalMode = "ask-writes";

  // Decline with a note.
  hub.ask = (async () => ({ allow: false, note: "not now" })) as typeof hub.ask;
  await manager.goalSet(id, "g", { check: "pnpm test" });
  await settle();
  const paused = (await manager.open(id)).goal!;
  assert.equal(paused.status, "paused");
  assert.match(paused.pausedReason ?? "", /declined.*not now/);
  assert.equal(executed, 0);

  // Always allow: asked once, then never again. Exit 0 would end the goal, so make the check fail.
  let asked = 0;
  hub.ask = (async () => (asked++, { allow: true, always: true })) as typeof hub.ask;
  live.session.executeBash = async () => (executed++, { output: "bad", exitCode: 1, cancelled: false, truncated: false });
  await manager.goalSet(id, "g", { check: "pnpm test" });
  await settle();
  await settle();
  assert.equal(asked, 1);
  assert.equal(executed, 2);
  assert.ok(live.alwaysAllowed.has("bash"));

  // Cleared while the approval is pending: the command is not run.
  live.alwaysAllowed.clear();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  hub.ask = (async () => (await gate, { allow: true })) as typeof hub.ask;
  await manager.goalSet(id, "g", { check: "pnpm test" });
  const before = executed;
  priv.onEvent(live, { type: "agent_start" });
  priv.onEvent(live, { type: "agent_settled" });
  await new Promise((r) => setTimeout(r, 20));
  await manager.goalClear(id);
  release();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(executed, before);
});

test("the continuation prompt carries only the tail of a long check output", async () => {
  const long = `HEAD${"x".repeat(5000)}TAIL`;
  const h = harness([PROGRESS], async () => ({ exitCode: 1, output: long, durationMs: 1 }));
  await h.runner.set("t", "g", { check: "pnpm test" });
  await h.runner.onSettle("t", "completed", 1);
  assert.match(h.prompts[1], /TAIL\n/);
  assert.doesNotMatch(h.prompts[1], /HEAD/);
  assert.match(h.judged[0], /HEAD/);
  const evidence = h.decisions.find((d) => d.kind === "goal_verdict")!.evidence ?? "";
  assert.match(evidence, /HEAD/);
});
