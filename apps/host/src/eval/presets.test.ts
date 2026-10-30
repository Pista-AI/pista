import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceDiff } from "./diff.ts";
import { addResult, childEnv, fixturePaths, judgePrompt, failed, finalText, loadTasks, parseJudge, parseResult, runEval, summarize, tally, toMarkdown } from "./presets.ts";
const root = fileURLToPath(new URL("../../../../evals/presets", import.meta.url));
const base = { presetsDir: `${root}/presets`, tasksDir: `${root}/tasks` };

test("fake run over every task and both presets passes and produces the report shape", async () => {
  const report = await runEval({ ...base, presets: ["solo", "routed"], tasks: "*", runs: 1, fake: true });
  const n = loadTasks(base.tasksDir, "*").length;
  assert.equal(report.results.length, 2 * n);
  for (const r of report.results) assert.ok(r.pass, `${r.preset}/${r.task}: ${r.error ?? "check failed"}`);
  assert.deepEqual(report.summary.map((s) => [s.preset, s.runs, s.passRate]), [["solo", n, 1], ["routed", n, 1]]);
  const first = report.results[0]!;
  for (const key of ["seconds", "input", "output", "cacheRead", "cacheWrite", "costUsd", "subAgentCalls"] as const) assert.equal(typeof first[key], "number", key);
  assert.ok(Array.isArray(first.verifyLines));
  assert.equal(first.finalText, "Done.");
  assert.match(first.model ?? "", /^[^/]+\/.+/);
  const md = toMarkdown(report);
  assert.match(md, /Parent models: solo = /);
  assert.match(md, /\| preset \| runs \| pass rate \| mean cost \(USD\) \| mean tokens \| mean time \(s\) \| mean sub-agent calls \| mean quality \(1-5\) \| mean diff lines \| verify pass\/fail\/skip \|/);
  assert.match(md, new RegExp(`\\| solo \\| ${n} \\| 100% \\|`));
  assert.match(md, new RegExp(`\\| routed \\| ${n} \\| 100% \\|`));
});

test("a real run needs --max-usd and --model", async () => {
  await assert.rejects(runEval({ ...base, presets: ["solo"], tasks: "*", runs: 1 }), /--max-usd is required/);
  await assert.rejects(runEval({ ...base, presets: ["solo"], tasks: "*", runs: 1, maxUsd: 1 }), /--model/);
});

test("cost, tokens, sub-agent calls and verify lines are tallied", async () => {
  const usage = { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 18, cost: { total: 0.25 } };
  const msg = (u = usage) => ({ role: "assistant", content: [{ type: "toolCall", id: "1", name: "agent", arguments: {} }], provider: "p", model: "m", usage: u, stopReason: "stop", timestamp: 0 });
  const t = tally([msg(), { role: "toolResult", toolName: "agent", content: [{ type: "text", text: "ok\nverify: passed" }] }] as never, [[msg()] as never]);
  assert.equal(t.costUsd, 0.5);
  assert.equal(t.input, 20);
  assert.equal(t.subAgentCalls, 1);
  assert.deepEqual(t.verifyLines, ["verify: passed"]);
  const s = summarize([{ preset: "a", task: "t", run: 1, pass: true, seconds: 2, diffStats: { files: 0, added: 0, removed: 0 }, judgeCostUsd: 0, ...t }], ["a"]);
  assert.equal(s[0]!.meanCostUsd, 0.5);
  assert.equal(s[0]!.meanSubAgentCalls, 1);
  assert.deepEqual(s[0]!.verify, { passed: 1, failed: 0, skipped: 0 });
});

test("task patterns select by name, comma list or prefix", () => {
  const fixTasks = readdirSync(base.tasksDir).filter((name) => name.startsWith("fix-"));
  assert.ok(fixTasks.length >= 2);
  assert.equal(loadTasks(base.tasksDir, "fix-*").length, fixTasks.length);
  assert.equal(loadTasks(base.tasksDir, "fix-slugify,add-chunk").length, 2);
  assert.throws(() => loadTasks(base.tasksDir, "nope"), /No task matches/);
});

test("a hung run is recorded as a timeout, and the report counts as failed", async () => {
  const report = await runEval({ ...base, presets: ["solo"], tasks: "fix-*", runs: 1, fake: true, fakeHang: true, runTimeoutSec: 2 });
  assert.equal(report.results[0]!.error, "timeout");
  assert.equal(report.results[0]!.pass, false);
  assert.ok(failed(report));
});

test("usage is tallied from a run that errored", () => {
  const usage = { input: 3, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 4, cost: { total: 0.1 } };
  const failedMsg = { role: "assistant", content: [], provider: "p", model: "m", usage, stopReason: "error", timestamp: 0 };
  assert.equal(tally([failedMsg] as never, []).costUsd, 0.1);
});

test("NaN and non-positive numeric options are rejected", async () => {
  const o = { ...base, presets: ["solo"], tasks: "*", fake: true };
  await assert.rejects(runEval({ ...o, runs: NaN }), /--runs/);
  await assert.rejects(runEval({ ...o, runs: 1, maxUsd: NaN }), /--max-usd/);
  await assert.rejects(runEval({ ...o, runs: 1, runTimeoutSec: NaN }), /--run-timeout/);
  await assert.rejects(runEval({ ...o, runs: 0 }), /--runs/);
});

test("the child env keeps PATH and API keys and drops PISTA_*, PI_* and NODE_OPTIONS", () => {
  const env = childEnv(
    { PATH: "/bin", HOME: "/h", OPENAI_API_KEY: "k", PISTA_POLICY_URL: "https://x", PI_SOMETHING: "1", NODE_OPTIONS: "--inspect", PISTA_HOME: "/real" },
    { home: "/s/home", agent: "/s/agent", memory: "/s/mem" },
  );
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "OPENAI_API_KEY", "PATH", "PISTA_HOME", "PI_CODING_AGENT_DIR", "PI_MEMORY_DIR"]);
  assert.equal(env.PISTA_HOME, "/s/home");
});

test("garbage child output yields no result instead of throwing", () => {
  assert.equal(parseResult("__EVAL_RESULT__ {not json"), undefined);
  assert.equal(parseResult("__EVAL_RESULT__ 5"), undefined);
  assert.equal(parseResult(""), undefined);
  assert.equal(parseResult('__EVAL_RESULT__ {"pass":true}')?.pass, true);
});

test("finalText keeps the last assistant text or its provider error", () => {
  const a = (text: string, extra = {}) => ({ role: "assistant", content: [{ type: "text", text }], provider: "p", model: "m", stopReason: "stop", timestamp: 0, ...extra });
  assert.equal(finalText([a("first"), { role: "user", content: "x", timestamp: 0 }, a("last")] as never), "last");
  assert.equal(finalText([a("", { stopReason: "error", errorMessage: "429" })] as never), "[error] 429");
  assert.equal(finalText([] as never), undefined);
});

test("a fake run records the diff, and a judged one records the reviewer score and its cost line", async () => {
  const plain = await runEval({ ...base, presets: ["solo"], tasks: "fix-slugify", runs: 1, fake: true });
  const r = plain.results[0]!;
  assert.ok(r.diff && r.diff.includes("diff --git") && !r.diff.includes(".pista"), "diff recorded without harness files");
  assert.ok(r.diffStats.files >= 1 && r.diffStats.added >= 1);
  assert.equal(r.quality, undefined);
  assert.match(toMarkdown(plain), /\| – \|/);
  const judged = await runEval({ ...base, presets: ["solo"], tasks: "fix-slugify", runs: 1, fake: true, judge: "fake" });
  assert.equal(judged.results[0]!.quality?.mean, 4);
  assert.equal(judged.summary[0]!.meanQuality, 4);
  assert.ok(judged.results[0]!.pass);
  assert.match(toMarkdown(judged), /\| 4\.00 \|[^\n]*\n[\s\S]*Reviewer cost/);
});

test("the reviewer reply is parsed from plain JSON or JSON inside prose; anything else is an error", () => {
  const body = { spec: { score: 5, reason: "a" }, minimal: { score: 4, reason: "b" }, readable: { score: 3, reason: "c" }, safe: { score: 4, reason: "d" }, structure: { score: 4, reason: "e" } };
  const ok = parseJudge(JSON.stringify(body));
  assert.ok("quality" in ok && ok.quality.mean === 4 && ok.quality.structure === 4 && ok.quality.notes.includes("spec: a") && ok.quality.notes.includes("structure: e"));
  const wrapped = parseJudge(`Sure! Here is my review:\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\`\nHope that helps {really}.`);
  assert.ok("quality" in wrapped && wrapped.quality.safe === 4);
  assert.ok("error" in parseJudge("no json here"));
  assert.ok("error" in parseJudge('{"spec":{"score":9,"reason":"x"}}'));
});

test("a reviewer reply without the structure score is rejected", () => {
  const body = { spec: { score: 5, reason: "a" }, minimal: { score: 4, reason: "b" }, readable: { score: 3, reason: "c" }, safe: { score: 4, reason: "d" } };
  assert.ok("error" in parseJudge(JSON.stringify(body)));
});

test("the diff has relative paths for modified, added and deleted files and skips harness dirs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "diff-test-"));
  try {
    const put = (base: string, file: string, text: string) => {
      mkdirSync(join(dir, base, file, ".."), { recursive: true });
      writeFileSync(join(dir, base, file), text);
    };
    put("stage/fixture", "keep.txt", "one\n");
    put("stage/fixture", "gone.txt", "bye\n");
    put("work", "keep.txt", "two\n");
    put("work", "fresh.txt", "new\n");
    put("work", ".pista/verify.json", "{}");
    put("work", "node_modules/x/index.js", "x");
    const { diff, stats } = await workspaceDiff(join(dir, "stage/fixture"), join(dir, "work"));
    assert.ok(!diff.includes(dir) && !diff.includes("stage/fixture") && !/\bwork\//.test(diff), diff);
    assert.ok(!diff.includes(".pista") && !diff.includes("node_modules"));
    assert.deepEqual(stats, { files: 3, added: 2, removed: 2 });
    for (const f of ["keep.txt", "gone.txt", "fresh.txt"]) assert.match(diff, new RegExp(`diff --git a/${f} b/${f}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the reviewer prompt holds the task, diff and fixture paths, and notes truncation", () => {
  const p = judgePrompt("Fix the bug", "diff --git a/x b/x\n+y\n", ["src/a.ts", "src/b.ts"]);
  assert.ok(p.includes("Fix the bug") && p.includes("+y") && !p.includes("cut off"));
  assert.ok(p.includes("Repo files before the change (paths only):\nsrc/a.ts\nsrc/b.ts"));
  assert.ok(!judgePrompt("Fix the bug", "d").includes("Repo files"));
  assert.match(judgePrompt("t", "d\n[diff truncated]\n"), /cut off/);
});

test("fixture paths are listed relative, sorted, skip harness dirs and are capped", () => {
  const dir = mkdtempSync(join(tmpdir(), "paths-test-"));
  try {
    for (const f of ["z.ts", "src/b.ts", "src/a.ts", "node_modules/x/i.js", ".pista/verify.json", ".git/HEAD"]) {
      mkdirSync(join(dir, f, ".."), { recursive: true });
      writeFileSync(join(dir, f), "x");
    }
    assert.deepEqual(fixturePaths(dir), ["src/a.ts", "src/b.ts", "z.ts"]);
    assert.deepEqual(fixturePaths(dir, 2), ["src/a.ts", "src/b.ts", "... (1 more)"]);
    assert.deepEqual(fixturePaths(join(dir, "missing")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reviewer cost counts toward the total (and so the cap) but not the run's cost", () => {
  const report = { results: [], totalCostUsd: 0 };
  const r = { preset: "a", task: "t", run: 1, pass: true, seconds: 1, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0.5, subAgentCalls: 0, verifyLines: [], diffStats: { files: 0, added: 0, removed: 0 }, judgeCostUsd: 0.25 };
  addResult(report, r);
  assert.equal(report.totalCostUsd, 0.75);
  assert.equal(r.costUsd, 0.5);
});

test("the reviewer reply may hold stray braces before the real JSON", () => {
  const body = { spec: { score: 2, reason: "a" }, minimal: { score: 2, reason: "b" }, readable: { score: 2, reason: "c" }, safe: { score: 2, reason: "d" }, structure: { score: 2, reason: "e" } };
  const r = parseJudge(`I looked at {the diff}. ${JSON.stringify(body)}`);
  assert.ok("quality" in r && r.quality.mean === 2);
});

test("session files are kept under <outDir>/sessions by default and skipped without outDir", async () => {
  const out = mkdtempSync(join(tmpdir(), "pista-eval-out-"));
  try {
    const kept = await runEval({ ...base, presets: ["solo"], tasks: "fix-slugify", runs: 1, fake: true, outDir: out });
    const rel = kept.results[0]!.sessionsDir!;
    assert.equal(rel, join("sessions", "solo", "fix-slugify-1"));
    const files = (readdirSync(join(out, rel), { recursive: true }) as string[]).filter((f) => f.endsWith(".jsonl"));
    assert.ok(files.length >= 1);
    assert.ok(!(readdirSync(join(out, rel), { recursive: true }) as string[]).some((f) => /auth|models/.test(f)));
    const skipped = await runEval({ ...base, presets: ["solo"], tasks: "fix-slugify", runs: 1, fake: true });
    assert.equal(skipped.results[0]!.sessionsDir, undefined);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
