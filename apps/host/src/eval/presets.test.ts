import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { setupHome } from "../test-helpers.ts";

setupHome("eval");
const { runEval, summarize, tally, toMarkdown, loadTasks } = await import("./presets.ts");
const root = fileURLToPath(new URL("../../../../evals/presets", import.meta.url));
const base = { presetsDir: `${root}/presets`, tasksDir: `${root}/tasks` };

test("fake run over both tasks and both presets passes and produces the report shape", async () => {
  const report = await runEval({ ...base, presets: ["solo", "routed"], tasks: "*", runs: 1, fake: true });
  assert.equal(report.results.length, 4);
  for (const r of report.results) assert.ok(r.pass, `${r.preset}/${r.task}: ${r.error ?? "check failed"}`);
  assert.deepEqual(report.summary.map((s) => [s.preset, s.runs, s.passRate]), [["solo", 2, 1], ["routed", 2, 1]]);
  const first = report.results[0]!;
  for (const key of ["seconds", "input", "output", "cacheRead", "cacheWrite", "costUsd", "subAgentCalls"] as const) assert.equal(typeof first[key], "number", key);
  assert.ok(Array.isArray(first.verifyLines));
  const md = toMarkdown(report);
  assert.match(md, /\| preset \| runs \| pass rate \| mean cost \(USD\) \| mean tokens \| mean time \(s\) \|/);
  assert.match(md, /\| solo \| 2 \| 100% \|/);
  assert.match(md, /\| routed \| 2 \| 100% \|/);
});

test("a real run needs --max-usd and --model", async () => {
  await assert.rejects(runEval({ ...base, presets: ["solo"], tasks: "*", runs: 1 }), /--max-usd is required/);
  await assert.rejects(runEval({ ...base, presets: ["solo"], tasks: "*", runs: 1, maxUsd: 1 }), /--model/);
});

test("the cap aborts remaining runs, and cost, tokens, sub-agent calls and verify lines are tallied", async () => {
  // Fake runs report zero cost, so any cap below zero is already exceeded.
  const capped = await runEval({ ...base, presets: ["solo"], tasks: "*", runs: 1, fake: true, maxUsd: -1 });
  assert.equal(capped.results.length, 0);
  assert.match(capped.aborted ?? "", /exceeded --max-usd/);
  const usage = { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 18, cost: { total: 0.25 } };
  const msg = (u = usage) => ({ role: "assistant", content: [{ type: "toolCall", id: "1", name: "agent", arguments: {} }], provider: "p", model: "m", usage: u, stopReason: "stop", timestamp: 0 });
  const t = tally([msg(), { role: "toolResult", toolName: "agent", content: [{ type: "text", text: "ok\nverify: passed" }] }] as never, [[msg()] as never]);
  assert.equal(t.costUsd, 0.5);
  assert.equal(t.input, 20);
  assert.equal(t.subAgentCalls, 1);
  assert.deepEqual(t.verifyLines, ["verify: passed"]);
  const s = summarize([{ preset: "a", task: "t", run: 1, pass: true, seconds: 2, ...t }], ["a"]);
  assert.equal(s[0]!.meanCostUsd, 0.5);
});

test("task patterns select by name, comma list or prefix", () => {
  assert.equal(loadTasks(base.tasksDir, "fix-*").length, 1);
  assert.equal(loadTasks(base.tasksDir, "fix-slugify,add-chunk").length, 2);
  assert.throws(() => loadTasks(base.tasksDir, "nope"), /No task matches/);
});
