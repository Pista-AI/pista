import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { GoalState } from "@pista/protocol";
import {
  applySettle,
  buildJudgePrompt,
  continuationPrompt,
  createGoal,
  judgeGoal,
  parseVerdict,
  pause,
  resolveJudgeModel,
  resume,
  type Verdict,
} from "./goal.ts";

const notMet = (progress: boolean): Verdict => ({ verdict: "not_met", progress, evidence: "still missing b.txt" });
const done = (g: GoalState, v?: Verdict, tokens = 100) => applySettle(g, { kind: "completed", tokens }, v);

test("createGoal defaults", () => {
  const g = createGoal("make files");
  assert.equal(g.status, "running");
  assert.equal(g.maxTurns, 25);
  assert.equal(g.turns, 0);
  assert.equal(g.tokensUsed, 0);
  assert.equal(g.noProgressTurns, 0);
  assert.equal(g.maxTokens, undefined);
  assert.equal(createGoal("x", { maxTurns: 3, maxTokens: 500 }).maxTokens, 500);
});

test("met stops", () => {
  const g = createGoal("g");
  const r = done(g, { verdict: "met", progress: true, evidence: "ls shows a.txt b.txt c.txt" });
  assert.equal(r.action, "stop");
  assert.equal(r.goal.status, "met");
  assert.equal(r.goal.turns, 1);
  assert.equal(r.goal.tokensUsed, 100);
  assert.match(r.goal.lastVerdict ?? "", /met.*a\.txt/);
  assert.equal(g.status, "running", "input is not mutated");
});

test("impossible stops", () => {
  const r = done(createGoal("g"), { verdict: "impossible", progress: false, evidence: "no network" });
  assert.equal(r.action, "stop");
  assert.equal(r.goal.status, "impossible");
});

test("not_met with progress continues and resets the no-progress counter", () => {
  const g = { ...createGoal("g"), noProgressTurns: 2 };
  const r = done(g, notMet(true));
  assert.equal(r.action, "continue");
  assert.equal(r.goal.status, "running");
  assert.equal(r.goal.turns, 1);
  assert.equal(r.goal.noProgressTurns, 0);
});

test("three turns without progress stop with no_progress", () => {
  let g = createGoal("g");
  for (let i = 1; i <= 2; i++) {
    const r = done(g, notMet(false));
    assert.equal(r.action, "continue");
    assert.equal(r.goal.noProgressTurns, i);
    g = r.goal;
  }
  const r = done(g, notMet(false));
  assert.equal(r.action, "stop");
  assert.equal(r.goal.status, "no_progress");
  assert.equal(r.goal.turns, 3);
});

test("progress in between resets the stall count", () => {
  let g = createGoal("g");
  g = done(g, notMet(false)).goal;
  g = done(g, notMet(false)).goal;
  g = done(g, notMet(true)).goal;
  const r = done(g, notMet(false));
  assert.equal(r.action, "continue");
  assert.equal(r.goal.noProgressTurns, 1);
});

test("missing verdict counts as no progress", () => {
  const r = done(createGoal("g"), undefined);
  assert.equal(r.action, "continue");
  assert.equal(r.goal.noProgressTurns, 1);
  assert.equal(r.goal.turns, 1);
  assert.match(r.goal.lastVerdict ?? "", /unparseable verdict/);
});

test("turn budget exhausts", () => {
  let g = createGoal("g", { maxTurns: 2 });
  const first = done(g, notMet(true));
  assert.equal(first.action, "continue");
  g = first.goal;
  const second = done(g, notMet(true));
  assert.equal(second.action, "stop");
  assert.equal(second.goal.status, "budget_exhausted");
  assert.equal(second.goal.turns, 2);
});

test("token budget exhausts, including judge tokens passed in", () => {
  const g = createGoal("g", { maxTokens: 1000 });
  const first = done(g, notMet(true), 600);
  assert.equal(first.action, "continue");
  const second = done(first.goal, notMet(true), 400);
  assert.equal(second.action, "stop");
  assert.equal(second.goal.status, "budget_exhausted");
  assert.equal(second.goal.tokensUsed, 1000);
});

test("met wins over an exhausted budget", () => {
  const g = createGoal("g", { maxTurns: 1 });
  const r = done(g, { verdict: "met", progress: true, evidence: "file exists" });
  assert.equal(r.goal.status, "met");
});

test("every continue increments turns", () => {
  let g = createGoal("g");
  for (const v of [notMet(true), notMet(false), undefined, notMet(true)]) {
    const before = g.turns;
    const r = done(g, v);
    if (r.action === "continue") assert.equal(r.goal.turns, before + 1);
    g = r.goal;
  }
});

test("aborted, error and guard_stopped pause without evaluation", () => {
  for (const kind of ["aborted", "error", "guard_stopped"] as const) {
    const g = { ...createGoal("g"), turns: 2, noProgressTurns: 1, tokensUsed: 50 };
    const r = applySettle(g, { kind, tokens: 25 });
    assert.equal(r.action, "pause", kind);
    assert.equal(r.goal.status, "paused");
    assert.ok(r.goal.pausedReason);
    assert.equal(r.goal.tokensUsed, 75);
    assert.equal(r.goal.turns, 2);
    assert.equal(r.goal.noProgressTurns, 1);
  }
});

test("pause and resume", () => {
  const paused = pause(createGoal("g"), "by hand");
  assert.equal(paused.status, "paused");
  assert.equal(paused.pausedReason, "by hand");

  const stalled = { ...paused, noProgressTurns: 2 };
  const resumed = resume(stalled);
  assert.equal(resumed.status, "running");
  assert.equal(resumed.noProgressTurns, 0);
  assert.equal(resumed.pausedReason, undefined);
  assert.ok(!("pausedReason" in resumed));
});

test("resume is a no-op from non-paused states", () => {
  const running = createGoal("g");
  assert.equal(resume(running), running);
  for (const status of ["met", "impossible", "budget_exhausted", "no_progress"] as const) {
    const g = { ...running, status, noProgressTurns: 2 };
    assert.equal(resume(g), g);
  }
});

test("pause is a no-op for terminal goals", () => {
  const g = { ...createGoal("g"), status: "met" as const };
  assert.equal(pause(g, "x"), g);
});

test("continuationPrompt mentions goal, verdict and STATUS.md", () => {
  const g = { ...createGoal("ship the thing"), lastVerdict: "not_met: b.txt missing" };
  const text = continuationPrompt(g);
  assert.match(text, /ship the thing/);
  assert.match(text, /b\.txt missing/);
  assert.match(text, /\.pista\/STATUS\.md/);
});

test("parseVerdict accepts plain, fenced and prose-wrapped JSON", () => {
  const json = '{"verdict":"not_met","progress":true,"evidence":"half done"}';
  const expected = { verdict: "not_met", progress: true, evidence: "half done" };
  assert.deepEqual(parseVerdict(json), expected);
  assert.deepEqual(parseVerdict("```json\n" + json + "\n```"), expected);
  assert.deepEqual(parseVerdict(`Here is my answer: ${json} Hope that helps {not json}`), expected);
});

test("parseVerdict handles braces inside strings and skips non-matching objects", () => {
  const raw = '{"note":1} then {"verdict":"met","progress":true,"evidence":"saw \\"}\\" in output {x}"}';
  const v = parseVerdict(raw);
  assert.equal(v?.verdict, "met");
  assert.equal(v?.evidence, 'saw "}" in output {x}');
});

test("parseVerdict rejects garbage and wrong shapes", () => {
  assert.equal(parseVerdict(""), undefined);
  assert.equal(parseVerdict("I think it is done"), undefined);
  assert.equal(parseVerdict("{not json}"), undefined);
  assert.equal(parseVerdict('{"verdict":"maybe","progress":true,"evidence":"x"}'), undefined);
  assert.equal(parseVerdict('{"verdict":"met","progress":"yes","evidence":"x"}'), undefined);
  assert.equal(parseVerdict('{"verdict":"met","progress":true}'), undefined);
  assert.equal(parseVerdict('["met"]'), undefined);
});

test("met without evidence is downgraded to not_met", () => {
  for (const evidence of ["", "   \n"]) {
    const v = parseVerdict(JSON.stringify({ verdict: "met", progress: true, evidence }));
    assert.equal(v?.verdict, "not_met");
    assert.equal(v?.progress, false);
  }
});

test("buildJudgePrompt caps the tail, keeping the end", () => {
  const tail = "A".repeat(20_000) + "THE_END";
  const { system, user } = buildJudgePrompt("my goal", tail);
  assert.match(user, /my goal/);
  assert.ok(user.includes("THE_END"));
  assert.ok(user.length < 12_000 + 500);
  assert.ok(!user.includes("A".repeat(12_001)));
  assert.match(system, /evidence/);
  assert.match(system, /impossible/);
  assert.match(system, /JSON/);
});

const fakeModels = {} as ModelRuntime;
const ref = { provider: "p", id: "m" };

test("judgeGoal parses fenced JSON from an injected completer and reports tokens", async () => {
  let seen: { system: string; user: string } | undefined;
  const r = await judgeGoal(fakeModels, ref, createGoal("make a.txt"), "tail text", async (_m, _r, prompt) => {
    seen = prompt;
    return { text: '```json\n{"verdict":"met","progress":true,"evidence":"a.txt exists"}\n```', tokens: 321 };
  });
  assert.equal(r.verdict?.verdict, "met");
  assert.equal(r.tokens, 321);
  assert.match(seen?.user ?? "", /make a\.txt/);
  assert.match(seen?.user ?? "", /tail text/);
});

test("judgeGoal: missing usage gives 0 tokens, garbage gives no verdict, failure does not throw", async () => {
  const goal = createGoal("g");
  const noUsage = await judgeGoal(fakeModels, ref, goal, "t", async () => ({
    text: '{"verdict":"not_met","progress":false,"evidence":"x"}',
  }));
  assert.equal(noUsage.tokens, 0);
  assert.equal(noUsage.verdict?.verdict, "not_met");

  const garbage = await judgeGoal(fakeModels, ref, goal, "t", async () => ({ text: "no idea", tokens: 5 }));
  assert.equal(garbage.verdict, undefined);
  assert.equal(garbage.tokens, 5);
  assert.equal(garbage.error, undefined);

  const failed = await judgeGoal(fakeModels, ref, goal, "t", async () => {
    throw new Error("network");
  });
  assert.deepEqual(failed, { tokens: 0, error: "network" });
});

test("parseVerdict is case-insensitive on the verdict", () => {
  assert.equal(parseVerdict('{"verdict":"MET","progress":true,"evidence":"x"}')?.verdict, "met");
  assert.equal(parseVerdict('{"verdict":" Not_Met ","progress":false,"evidence":"x"}')?.verdict, "not_met");
  assert.equal(parseVerdict('{"verdict":"Impossible","progress":false,"evidence":"x"}')?.verdict, "impossible");
});

test("createGoal ignores non-finite or sub-1 budgets", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5]) {
    const g = createGoal("g", { maxTurns: bad, maxTokens: bad });
    assert.equal(g.maxTurns, 25);
    assert.equal(g.maxTokens, undefined);
  }
});

test("NaN maxTurns still stops at the default budget", () => {
  let g = createGoal("g", { maxTurns: Number.NaN });
  let last = { goal: g, action: "continue" as string };
  for (let i = 0; i < 25 && last.action === "continue"; i++) {
    last = done(g, notMet(true));
    g = last.goal;
  }
  assert.equal(last.action, "stop");
  assert.equal(last.goal.status, "budget_exhausted");
  assert.equal(last.goal.turns, 25);
});

test("applySettle and pause do not mutate their input", () => {
  const snapshot = (g: GoalState) => JSON.stringify(g);
  const cont = createGoal("g");
  const before = snapshot(cont);
  assert.equal(done(cont, notMet(true)).action, "continue");
  assert.equal(snapshot(cont), before);

  const stall = { ...createGoal("g"), noProgressTurns: 1 };
  const stallBefore = snapshot(stall);
  assert.equal(done(stall, notMet(false)).goal.noProgressTurns, 2);
  assert.equal(snapshot(stall), stallBefore);

  const running = createGoal("g");
  const runningBefore = snapshot(running);
  assert.equal(applySettle(running, { kind: "error", tokens: 1 }).action, "pause");
  assert.equal(pause(running, "x").status, "paused");
  assert.equal(snapshot(running), runningBefore);
});

test("a maxTokens goal ends in stop with accumulated tokens on a completed turn", () => {
  const g = { ...createGoal("g", { maxTokens: 500 }), tokensUsed: 450, turns: 3 };
  const r = done(g, notMet(true), 80);
  assert.equal(r.action, "stop");
  assert.equal(r.goal.status, "budget_exhausted");
  assert.equal(r.goal.tokensUsed, 530);
  assert.equal(r.goal.turns, 4);
});

test("a missing verdict counts as no progress and is labelled unparseable", () => {
  const { goal } = done(createGoal("g"), undefined);
  assert.equal(goal.noProgressTurns, 1);
  assert.equal(goal.lastVerdict, "unparseable verdict");
});

test("resolveJudgeModel prefers the thread model, then the default", () => {
  const dflt = { provider: "p", id: "default" };
  assert.deepEqual(resolveJudgeModel({ provider: "a", id: "thread", extra: 1 } as never, dflt), { provider: "a", id: "thread" });
  assert.deepEqual(resolveJudgeModel(undefined, dflt), dflt);
  assert.deepEqual(resolveJudgeModel({ provider: "unknown", id: "x" }, dflt), dflt);
  assert.equal(resolveJudgeModel(undefined, undefined), undefined);
});
