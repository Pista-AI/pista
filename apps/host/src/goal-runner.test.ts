import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage, DecisionEntry, GoalState } from "@pista/protocol";
import { GoalRunner, runTokens, runUsage, transcriptTail } from "./goal-runner.ts";
import type { Verdict } from "./goal.ts";
import { liveOf, makeManager, setupHome } from "./test-helpers.ts";

const { projectDir } = setupHome("goal");

const MET: Verdict = { verdict: "met", progress: true, evidence: "tests pass" };
const PROGRESS: Verdict = { verdict: "not_met", progress: true, evidence: "closer" };

function harness(verdicts: Verdict[], opts: { streaming?: () => boolean; judgeError?: string; raw?: string } = {}) {
  const prompts: string[] = [];
  const events: (GoalState | null)[] = [];
  const entries: (GoalState | null)[] = [];
  const judged: string[] = [];
  const decisions: Omit<DecisionEntry, "id" | "ts">[] = [];
  const runner = new GoalRunner(
    {
      isStreaming: () => opts.streaming?.() ?? false,
      hasQueued: () => false,
      prompt: async (_id, text) => void prompts.push(text),
      transcriptTail: () => "tail",
      persist: (_id, goal) => void entries.push(goal),
      emit: (_id, goal) => void events.push(goal),
      record: (_id, entry) => void decisions.push(entry),
    },
    async (_goal, tail) => {
      judged.push(tail);
      if (opts.judgeError) return { tokens: 3, error: opts.judgeError };
      return { verdict: verdicts.shift(), tokens: 5, ...(opts.raw ? { raw: opts.raw } : {}) };
    },
  );
  return { runner, prompts, events, entries, judged, decisions };
}

test("set on an idle thread sends the first continuation and persists and emits running", async () => {
  const h = harness([]);
  const goal = await h.runner.set("t", "make the tests pass");
  assert.equal(goal.status, "running");
  assert.equal(h.prompts.length, 1);
  assert.match(h.prompts[0], /make the tests pass/);
  assert.equal(h.entries.at(-1)?.status, "running");
  assert.equal(h.events.at(-1)?.status, "running");
});

test("not_met with progress triggers exactly one continuation", async () => {
  const h = harness([PROGRESS]);
  await h.runner.set("t", "g");
  await h.runner.onSettle("t", "completed", 100);
  assert.equal(h.prompts.length, 2);
  const goal = h.runner.get("t")!;
  assert.equal(goal.turns, 1);
  assert.equal(goal.tokensUsed, 105);
  assert.equal(goal.status, "running");
});

test("a not_met verdict with progress logs one goal_verdict and one goal_action with the rule that fired", async () => {
  const h = harness([PROGRESS]);
  await h.runner.set("t", "g");
  h.decisions.length = 0;
  await h.runner.onSettle("t", "completed", 100);
  assert.deepEqual(h.decisions.map((d) => d.kind), ["goal_verdict", "goal_action"]);
  const [verdict, action] = h.decisions;
  assert.equal(verdict!.summary, "Judge: not_met, progress yes");
  assert.equal(verdict!.reason, "closer");
  assert.deepEqual(verdict!.data, { verdict: { verdict: "not_met", progress: true }, turn: 1, tokens: 5 });
  assert.equal(action!.summary, "Continue toward goal (turn 1/25)");
  assert.equal(action!.reason, "not met, progress made; turn 1 of 25, 105 tokens used, no stall");
  assert.deepEqual(action!.data, {
    action: "continue",
    status: "running",
    turns: 1,
    maxTurns: 25,
    tokensUsed: 105,
    noProgressTurns: 0,
    settleKind: "completed",
  });
});

test("goal_verdict keeps the raw judge reply in data; an aborted turn logs only a pause action", async () => {
  const h = harness([MET], { raw: '```json\n{"verdict":"met"}\n```' });
  await h.runner.set("t", "g");
  h.decisions.length = 0;
  await h.runner.onSettle("t", "completed", 0);
  assert.equal(h.decisions[0]!.evidence, "tail");
  assert.equal(h.decisions[0]!.data?.rawReply, '```json {"verdict":"met"} ```');
  assert.equal(h.decisions[1]!.reason, "Judge returned met; evidence: tests pass");
  assert.equal(h.decisions[1]!.summary, "Stop: goal met");

  const a = harness([]);
  await a.runner.set("t", "g");
  a.decisions.length = 0;
  await a.runner.onSettle("t", "aborted", 0);
  assert.deepEqual(a.decisions.map((d) => d.kind), ["goal_action"]);
  assert.equal(a.decisions[0]!.summary, "Pause: Stopped by the user");
  assert.equal(a.decisions[0]!.data?.settleKind, "aborted");
});

test("user set, pause, resume and clear are logged with reason user", async () => {
  const h = harness([]);
  await h.runner.set("t", "ship it");
  h.runner.pause("t");
  await h.runner.resume("t");
  h.runner.clear("t");
  assert.deepEqual(h.decisions.map((d) => [d.kind, d.data?.action, d.reason]), [
    ["goal_action", "set", "User set the goal"],
    ["goal_action", "pause", "user"],
    ["goal_action", "resume", "user"],
    ["goal_action", "clear", "user"],
  ]);
  assert.equal(h.decisions[0]!.summary, "Goal set: ship it");
});

test("met stops, persists status met, and sends nothing", async () => {
  const h = harness([MET]);
  await h.runner.set("t", "g");
  await h.runner.onSettle("t", "completed", 0);
  assert.equal(h.prompts.length, 1);
  assert.equal(h.runner.get("t")?.status, "met");
  assert.equal(h.entries.at(-1)?.status, "met");
  assert.equal(h.events.at(-1)?.status, "met");
});

test("a judge failure pauses the goal instead of counting as no progress", async () => {
  const h = harness([], { judgeError: "model rejected" });
  await h.runner.set("t", "g");
  await h.runner.onSettle("t", "completed", 10);
  const goal = h.runner.get("t");
  assert.equal(goal?.status, "paused");
  assert.match(goal?.pausedReason ?? "", /^Judge failed: model rejected/);
  assert.equal(goal?.noProgressTurns, 0);
  assert.equal(goal?.turns, 0);
  assert.equal(goal?.tokensUsed, 13);
  assert.equal(h.prompts.length, 1);
  assert.equal(h.entries.at(-1)?.status, "paused");
  assert.equal(h.events.at(-1)?.status, "paused");
});

test("a judge failure logs judge_error and a pause goal_action", async () => {
  const h = harness([], { judgeError: "model rejected" });
  await h.runner.set("t", "g");
  h.decisions.length = 0;
  await h.runner.onSettle("t", "completed", 10);
  assert.deepEqual(h.decisions.map((d) => d.kind), ["judge_error", "goal_action"]);
  assert.equal(h.decisions[0]!.reason, "model rejected");
  assert.equal(h.decisions[1]!.data?.action, "pause");
  assert.equal(h.decisions[1]!.data?.status, "paused");
});

test("an unparseable verdict counts as no progress and goes on", async () => {
  const h = harness([]);
  await h.runner.set("t", "g");
  await h.runner.onSettle("t", "completed", 0);
  const goal = h.runner.get("t");
  assert.equal(goal?.status, "running");
  assert.equal(goal?.noProgressTurns, 1);
  assert.equal(goal?.lastVerdict, "unparseable verdict");
  assert.equal(h.prompts.length, 2);
});

test("a user prompt while the judge runs makes the result stale", async () => {
  const h = harness([PROGRESS]);
  await h.runner.set("t", "g");
  const settling = h.runner.onSettle("t", "completed", 0);
  h.runner.noteUserPrompt("t");
  await settling;
  assert.equal(h.prompts.length, 1);
  assert.equal(h.runner.get("t")?.turns, 0);
});

test("pause during judging drops the result and stays paused", async () => {
  const h = harness([PROGRESS]);
  await h.runner.set("t", "g");
  const settling = h.runner.onSettle("t", "completed", 0);
  h.runner.pause("t");
  await settling;
  assert.equal(h.prompts.length, 1);
  assert.equal(h.runner.get("t")?.status, "paused");
});

test("a busy thread or queued message blocks the continuation", async () => {
  let streaming = false;
  const h = harness([PROGRESS], { streaming: () => streaming });
  await h.runner.set("t", "g");
  streaming = true;
  await h.runner.onSettle("t", "completed", 0);
  assert.equal(h.prompts.length, 1);
});

test("an aborted settle pauses without judging", async () => {
  const h = harness([PROGRESS]);
  await h.runner.set("t", "g");
  await h.runner.onSettle("t", "aborted", 10);
  assert.equal(h.judged.length, 0);
  assert.equal(h.prompts.length, 1);
  const goal = h.runner.get("t")!;
  assert.equal(goal.status, "paused");
  assert.equal(goal.turns, 0);
  assert.equal(h.entries.at(-1)?.status, "paused");
});

test("resume continues a paused goal; clear persists a tombstone and emits null", async () => {
  const h = harness([]);
  await h.runner.set("t", "g");
  h.runner.pause("t");
  assert.equal((await h.runner.resume("t")).status, "running");
  assert.equal(h.prompts.length, 2);
  h.runner.clear("t");
  assert.equal(h.runner.get("t"), undefined);
  assert.equal(h.entries.at(-1), null);
  assert.equal(h.events.at(-1), null);
});

test("resume on a goal that is not paused is rejected", async () => {
  const h = harness([]);
  await h.runner.set("t", "g");
  await assert.rejects(h.runner.resume("t"), /Only a paused goal/);
  assert.equal(h.prompts.length, 1);
});

test("a failing continuation pauses the goal with the error", async () => {
  const runner = new GoalRunner(
    {
      isStreaming: () => false,
      hasQueued: () => false,
      prompt: async () => {
        throw new Error("No model");
      },
      transcriptTail: () => "",
      persist: () => {},
      emit: () => {},
      record: () => {},
    },
    async () => ({ tokens: 0 }),
  );
  const goal = await runner.set("t", "g");
  assert.equal(goal.status, "paused");
  assert.equal(goal.pausedReason, "No model");
});

test("restore pauses a goal that was running", () => {
  const h = harness([]);
  const saved: GoalState = { text: "g", status: "running", turns: 2, maxTurns: 25, tokensUsed: 9, sinceReplan: 0, noProgressTurns: 0, updatedAt: 1 };
  h.runner.restore("t", saved);
  assert.equal(h.runner.get("t")?.status, "paused");
  assert.equal(h.runner.get("t")?.pausedReason, "Host restarted");
  assert.equal(h.entries.at(-1)?.status, "paused");
});

test("transcriptTail keeps the newest lines within the cap; runTokens counts cache reads", () => {
  const usage = { input: 10, output: 5, cacheRead: 9999, cacheWrite: 0, totalTokens: 10014, cost: { total: 0 } };
  const messages: ChatMessage[] = [
    { role: "user", content: "old ".repeat(5000), timestamp: 1 },
    { role: "assistant", content: [{ type: "text", text: "done" }, { type: "toolCall", id: "1", name: "bash", arguments: { cmd: "ls" } }], provider: "p", model: "m", usage, stopReason: "stop", timestamp: 2 },
    { role: "toolResult", toolCallId: "1", toolName: "bash", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 3 },
  ];
  const tail = transcriptTail(messages, 200);
  assert.ok(tail.length <= 200);
  assert.match(tail, /TOOL RESULT \(bash\): ok$/);
  assert.match(tail, /TOOL CALL: bash/);
  assert.equal(runTokens(messages, 0), 10 + 5 + 9999);
  assert.deepEqual(runUsage(messages, 0), { billed: 10014, cacheRead: 9999 });
  assert.equal(runTokens(messages, 2), 0);
});

test("tokensUsed is the billed total and cache reads are tracked and explained", async () => {
  const h = harness([PROGRESS]);
  await h.runner.set("t", "g");
  h.decisions.length = 0;
  await h.runner.onSettle("t", "completed", 38_000, 30_000);
  const goal = h.runner.get("t")!;
  assert.equal(goal.tokensUsed, 38_005);
  assert.equal(goal.cacheReadTokens, 30_000);
  const action = h.decisions.find((d) => d.kind === "goal_action")!;
  assert.match(action.reason ?? "", /38k tokens used, 30k of them cache reads/);
  assert.equal(action.data?.tokensUsed, 38_005);
  assert.equal(action.data?.cacheReadTokens, 30_000);
});

// -- Real ThreadManager wiring ------------------------------------------------------------

test("ThreadManager: settle detection, snapshot, abort pause and restart restore", async () => {
  const verdicts: Verdict[] = [PROGRESS, PROGRESS];
  const { manager, project } = await makeManager({ projectDir, goalJudge: async () => ({ verdict: verdicts.shift(), tokens: 1 }) });
  const sent: string[] = [];
  const priv = manager as unknown as {
    send: (id: string, text: string) => Promise<{ run: Promise<void> }>;
    onEvent: (thread: unknown, event: unknown) => void;
  };
  priv.send = async (_id, text) => (sent.push(text), { run: Promise.resolve() });

  const snap = await manager.create(project.id);
  const id = snap.summary.id;
  const thread = liveOf<{ session: { messages: unknown[] } }>(manager).get(id)!;
  const settle = async (during?: () => Promise<void>) => {
    priv.onEvent(thread, { type: "agent_start" });
    await during?.();
    priv.onEvent(thread, { type: "agent_settled" });
    await new Promise((r) => setTimeout(r, 20));
  };
  const session = thread.session as unknown as { isStreaming: boolean; sessionManager: { getEntries(): { customType?: string }[] } };
  const streaming = (value: boolean) => Object.defineProperty(session, "isStreaming", { get: () => value, configurable: true });

  await manager.goalSet(id, "ship it", {});
  assert.equal(sent.length, 1);
  assert.equal((await manager.open(id)).goal?.status, "running");

  await settle();
  assert.equal(sent.length, 2);

  await settle();
  assert.equal(sent.length, 3);

  // An abort pauses the goal at once; the settle that follows sends nothing.
  await settle(async () => {
    streaming(true);
    await manager.abort(id).catch(() => {});
    streaming(false);
  });
  assert.equal(sent.length, 3);
  const paused = (await manager.open(id)).goal;
  assert.equal(paused?.status, "paused");
  assert.equal(paused?.pausedReason, "Stopped by the user");

  // Every transition is persisted as a custom session entry.
  assert.ok(session.sessionManager.getEntries().some((e) => e.customType === "pista.goal"));
  assert.equal((await manager.goalResume(id)).status, "running");
  assert.equal(sent.length, 4);
  manager.dispose();
});

test("ThreadManager: a goal that was running comes back paused after a restart", async () => {
  const { manager: first, models, project } = await makeManager({ projectDir, dispose: false });
  type Live = { session: { sessionManager: { appendMessage(m: unknown): void } } };
  (first as unknown as { send: () => Promise<{ run: Promise<void> }> }).send = async () => ({ run: Promise.resolve() });
  const { summary } = await first.create(project.id);
  assert.equal((await first.goalSet(summary.id, "survive restarts", {})).status, "running");
  // Pi writes the session file only once an assistant message exists.
  const manager = liveOf<Live>(first).get(summary.id)!.session.sessionManager;
  manager.appendMessage({ role: "user", content: "hi", timestamp: 1 });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    api: "x",
    provider: "p",
    model: "m",
    stopReason: "stop",
    timestamp: 2,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  });
  first.dispose();

  const { manager: second } = await makeManager({ models, dispose: false });
  await second.list();
  const goal = (await second.open(summary.id)).goal;
  assert.equal(goal?.status, "paused");
  assert.equal(goal?.pausedReason, "Host restarted");
  assert.equal(goal?.text, "survive restarts");
  second.dispose();
});

/** A real ThreadManager whose sessions pretend to have a model, with `session.prompt` recorded. */
async function sendHarness(prepareModel: () => Promise<void>, prompt: (text: string) => Promise<void>) {
  const { manager, project } = await makeManager({ projectDir, prepareModel });
  const { summary } = await manager.create(project.id);
  const live = liveOf<{ session: object; thinkingMode: string }>(manager).get(summary.id)!;
  Object.defineProperty(live.session, "model", { value: { provider: "p", id: "m" }, configurable: true });
  Object.defineProperty(live.session, "prompt", { value: prompt, configurable: true });
  live.thinkingMode = "off";
  return { manager, id: summary.id };
}

test("send: a continuation made stale while prepareModel is pending never reaches the session", async () => {
  const prompts: string[] = [];
  let release: () => void = () => {};
  const { manager, id } = await sendHarness(
    () => new Promise<void>((resolve) => (release = resolve)),
    async (text) => void prompts.push(text),
  );
  const pending = manager.goalSet(id, "g", {});
  await new Promise((r) => setTimeout(r, 10));
  await manager.goalPause(id); // the user acts inside the window
  release();
  await pending;
  assert.equal(prompts.length, 0);
  assert.equal((await manager.open(id)).goal?.status, "paused");
});

test("send: a prompt the session rejects pauses the running goal with the error", async () => {
  const { manager, id } = await sendHarness(async () => {}, async () => {
    throw new Error("401 invalid api key");
  });
  await manager.goalSet(id, "g", {});
  await new Promise((r) => setTimeout(r, 10));
  const goal = (await manager.open(id)).goal;
  assert.equal(goal?.status, "paused");
  assert.equal(goal?.pausedReason, "401 invalid api key");
});

test("abort pauses a running goal even when nothing is streaming", async () => {
  const prompts: string[] = [];
  const { manager, id } = await sendHarness(async () => {}, async (text) => void prompts.push(text));
  await manager.goalSet(id, "g", {});
  await manager.abort(id);
  const goal = (await manager.open(id)).goal;
  assert.equal(goal?.status, "paused");
  assert.equal(goal?.pausedReason, "Stopped by the user");
});
