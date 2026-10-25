import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage, DecisionEntry } from "@pista/protocol";
import { GoalRunner, leadingText } from "./goal-runner.ts";
import { continuationPrompt, createGoal, replanPrompt, REPLAN_PROMPT_FIRST_LINE, type Verdict } from "./goal.ts";

const PROGRESS: Verdict = { verdict: "not_met", progress: true, evidence: "closer" };
const STALLED: Verdict = { verdict: "not_met", progress: false, evidence: "looping" };

type Turn = { rationale?: string; planChanges?: string[] };

function harness(verdicts: Verdict[], turns: Turn[] = [], tail = "TRANSCRIPT TAIL") {
  const prompts: string[] = [];
  const decisions: Omit<DecisionEntry, "id" | "ts">[] = [];
  const runner = new GoalRunner(
    {
      isStreaming: () => false,
      hasQueued: () => false,
      prompt: async (_id, text) => void prompts.push(text),
      transcriptTail: () => tail,
      persist: () => {},
      emit: () => {},
      record: (_id, entry) => void decisions.push(entry),
      turnInfo: () => {
        const turn = turns.shift() ?? {};
        return { rationale: turn.rationale, planChanges: turn.planChanges ?? [] };
      },
    },
    async () => ({ verdict: verdicts.shift(), tokens: 1, raw: `{"raw":"${"r".repeat(900)}"}` }),
  );
  return { runner, prompts, decisions };
}

const isReplan = (prompt: string) => prompt.startsWith(REPLAN_PROMPT_FIRST_LINE);
const lastAction = (decisions: Omit<DecisionEntry, "id" | "ts">[]) => decisions.filter((d) => d.kind === "goal_action").at(-1)!;

test("replanPrompt starts with the stable first line and asks for the rationale, the plan update and a continuation", () => {
  const goal = { ...createGoal("ship it"), turns: 4 };
  const prompt = replanPrompt(goal, "not_met: looping", "Acceptance check failed (exit 1): pnpm test");
  assert.ok(prompt.split("\n")[0]!.startsWith("Replan checkpoint:"));
  assert.match(prompt, /\.pista\/PLAN\.md/);
  assert.match(prompt, /\.pista\/STATUS\.md/);
  assert.match(prompt, /3 to 6 lines/);
  assert.match(prompt, /`plan` tool/);
  assert.match(prompt, /Progress: 4 of at most 25/);
  assert.match(prompt, /Last evaluation: not_met: looping/);
  assert.match(prompt, /Acceptance check failed/);
  assert.match(continuationPrompt(goal), /Before continuing, state in one line why you are taking the next step/);
});

test("without replanEvery, continuations never trigger a cadence replan", async () => {
  const h = harness(Array.from({ length: 6 }, () => PROGRESS));
  await h.runner.set("t", "g");
  assert.equal(h.runner.get("t")!.replanEvery, undefined);
  for (let i = 0; i < 5; i++) await h.runner.onSettle("t", "completed", 1);
  assert.deepEqual(h.prompts.map(isReplan), [false, false, false, false, false, false]);
  assert.equal(h.decisions.some((d) => d.kind === "replan"), false);
  assert.equal(h.decisions[0]!.data?.replanEvery, "off");
});

test("replanEvery: 3 triggers a replan on the third continuation and then resets", async () => {
  const h = harness(Array.from({ length: 8 }, () => PROGRESS));
  await h.runner.set("t", "g", { replanEvery: 3 });
  for (let i = 0; i < 6; i++) await h.runner.onSettle("t", "completed", 1);
  // prompts[0] is the kickoff; prompts[n] is the nth continuation after a settle.
  assert.deepEqual(h.prompts.map(isReplan), [false, false, false, true, false, false, false]);
  const replans = h.decisions.filter((d) => d.kind === "replan");
  assert.equal(replans.length, 1);
  assert.equal(replans[0]!.summary, "Replan after 3 turns");
  assert.deepEqual(replans[0]!.data, { trigger: "cadence", turn: 4, sinceReplan: 3 });
});

test("replanEvery is configurable and recorded on the Goal set decision", async () => {
  const h = harness([PROGRESS, PROGRESS]);
  await h.runner.set("t", "g", { replanEvery: 2, maxTokens: 9000, check: "pnpm test" });
  const set = h.decisions[0]!;
  assert.equal(set.reason, "User set the goal");
  assert.deepEqual(
    { maxTurns: set.data?.maxTurns, maxTokens: set.data?.maxTokens, check: set.data?.check, replanEvery: set.data?.replanEvery },
    { maxTurns: 25, maxTokens: 9000, check: "pnpm test", replanEvery: 2 },
  );
  await h.runner.onSettle("t", "completed", 1);
  await h.runner.onSettle("t", "completed", 1);
  assert.deepEqual(h.prompts.map(isReplan), [false, false, true]);
});

test("a stalled verdict triggers a replan immediately and records the model's rationale, plan changes and trigger", async () => {
  const rationale = "We were editing the wrong module. ".repeat(30);
  const h = harness([STALLED, PROGRESS], [{}, { rationale, planChanges: ["s2 → blocked", "Plan set: 3 steps"] }]);
  await h.runner.set("t", "g");
  await h.runner.onSettle("t", "completed", 1);
  assert.ok(isReplan(h.prompts[1]!));
  assert.match(lastAction(h.decisions).reason ?? "", /next turn is a replan checkpoint \(stalled\)/);
  assert.equal(h.decisions.some((d) => d.kind === "replan"), false);

  h.decisions.length = 0;
  await h.runner.onSettle("t", "completed", 1);
  const replan = h.decisions.find((d) => d.kind === "replan")!;
  assert.equal(replan.summary, "Replan after stalled verdict");
  assert.equal(replan.reason!.length, 600);
  assert.ok(replan.reason!.startsWith("We were editing the wrong module."));
  assert.equal(replan.evidence, "s2 → blocked; Plan set: 3 steps");
  assert.deepEqual(replan.data, { trigger: "stalled", turn: 2, sinceReplan: 1 });
  assert.equal(h.runner.get("t")!.sinceReplan, 0);
});

test("a stalled replan turn does not immediately replan again", async () => {
  const h = harness([STALLED, STALLED]);
  await h.runner.set("t", "g");
  await h.runner.onSettle("t", "completed", 1);
  await h.runner.onSettle("t", "completed", 1);
  assert.deepEqual(h.prompts.map(isReplan), [false, true, false]);
});

test("goal_verdict evidence is the transcript the judge saw, the raw reply goes to data", async () => {
  const tail = `${"old ".repeat(1000)}NEWEST`;
  const h = harness([PROGRESS], [], tail);
  await h.runner.set("t", "g");
  h.decisions.length = 0;
  await h.runner.onSettle("t", "completed", 1);
  const verdict = h.decisions.find((d) => d.kind === "goal_verdict")!;
  assert.equal(verdict.evidence!.length, 2000);
  assert.ok(verdict.evidence!.endsWith("NEWEST"));
  assert.equal(verdict.reason, "closer");
  assert.equal((verdict.data?.rawReply as string).length, 600);
});

test("plain continuation turns record the first line of the agent's rationale on the goal_action", async () => {
  const h = harness([PROGRESS], [{ rationale: "Fixing the parser first because tests fail there.\nThen the writer." }]);
  await h.runner.set("t", "g");
  h.decisions.length = 0;
  await h.runner.onSettle("t", "completed", 1);
  assert.equal(lastAction(h.decisions).data?.agentRationale, "Fixing the parser first because tests fail there.");
});

test("goal_action reasons spell out the budget, the stall count and what decided a stop", async () => {
  const h = harness([PROGRESS, STALLED, { verdict: "met", progress: true, evidence: "all 12 tests pass" }]);
  await h.runner.set("t", "g", { maxTokens: 40_000 });
  await h.runner.onSettle("t", "completed", 17_998);
  assert.equal(lastAction(h.decisions).reason, "not met, progress made; turn 1 of 25, 18k tokens used of 40k, no stall");
  await h.runner.onSettle("t", "completed", 1);
  assert.match(lastAction(h.decisions).reason ?? "", /^not met, no progress; turn 2 of 25, 18k tokens used of 40k, 1 of 3 stalled turns/);
  await h.runner.onSettle("t", "completed", 1);
  assert.equal(lastAction(h.decisions).reason, "Judge returned met; evidence: all 12 tests pass");
});

test("leadingText returns the first assistant message's text before its first tool call", () => {
  const assistant = (content: Extract<ChatMessage, { role: "assistant" }>["content"]): ChatMessage => ({
    role: "assistant",
    content,
    provider: "p",
    model: "m",
    stopReason: "stop",
    timestamp: 2,
  });
  const messages: ChatMessage[] = [
    { role: "user", content: "old prompt", timestamp: 1 },
    assistant([{ type: "text", text: "old answer" }]),
    { role: "user", content: "Continue working toward the goal below.", timestamp: 3 },
    assistant([{ type: "text", text: "Reading the failing test first." }, { type: "toolCall", id: "1", name: "bash", arguments: {} }, { type: "text", text: "after the tool" }]),
    assistant([{ type: "text", text: "second message" }]),
  ];
  assert.equal(leadingText(messages), "Reading the failing test first.");
  assert.equal(leadingText(messages.slice(0, 3)), "");
});
