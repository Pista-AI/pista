import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxModels, makeManager, setupHome } from "./test-helpers.ts";

const { projectDir } = setupHome("verify-gate");
const { createAgentRunner } = await import("./subagent.ts");
const { parseVerifyConfig, runVerify } = await import("./verify.ts");
const { compileToolRules } = await import("./policy-tools.ts");

const { piAi, faux, models, ref } = await fauxModels();
const { manager, store, project } = await makeManager({ projectDir, models });
store.patchConfig({ defaultModel: ref, approvalMode: "full-access" });

type Result = { code: number | null; output: string; timedOut: boolean };
/** A fake runner that answers from a script (last entry repeats) and records the commands it was given. */
function fakeRunner(results: Partial<Result>[]) {
  const calls: { command: string; cwd: string; timeoutMs: number }[] = [];
  const run = async (command: string, opts: { cwd: string; timeoutMs: number }): Promise<Result> => {
    calls.push({ command, cwd: opts.cwd, timeoutMs: opts.timeoutMs });
    return { code: 0, output: "", timedOut: false, ...results[Math.min(calls.length - 1, results.length - 1)] };
  };
  return { run, calls };
}

function writeConfig(config: unknown) {
  mkdirSync(join(projectDir, ".pista"), { recursive: true });
  writeFileSync(join(projectDir, ".pista", "verify.json"), JSON.stringify(config));
}

const writeCall = () => piAi.fauxAssistantMessage(piAi.fauxToolCall("write", { path: join(projectDir, "out.txt"), content: "x" }));
const say = (text: string) => piAi.fauxAssistantMessage(text);

async function dispatch(role: "implementer" | "explorer", run: ReturnType<typeof fakeRunner>["run"]) {
  const { summary } = await manager.create(project.id);
  const runAgent = createAgentRunner({ threads: manager, ref: { threadId: summary.id }, verify: { store, run } });
  const result = await runAgent({ role, brief: "do it" });
  return result.content[0]!.text;
}

test("setup: the project is trusted with a verify.json", () => {
  store.setProjectTrusted(project.id, true);
  writeConfig({ commands: ["pnpm typecheck"], timeoutSec: 30 });
});

test("a passing verify appends 'Verify: passed' and runs in the project with the configured timeout", async () => {
  const runner = fakeRunner([{}]);
  faux.setResponses([writeCall(), say("report")]);
  const out = await dispatch("implementer", runner.run);
  assert.match(out, /^report\n\nVerify: passed\n\n\[sub-agent thread/);
  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0]!.command, "pnpm typecheck");
  assert.equal(runner.calls[0]!.cwd, projectDir);
  assert.equal(runner.calls[0]!.timeoutMs, 30_000);
});

test("a failing command is fed back and retried up to maxAttempts, then reported failed", async () => {
  writeConfig({ commands: ["pnpm typecheck"], maxAttempts: 3 });
  const runner = fakeRunner([{ code: 2, output: "x".repeat(6000) + "TS2322 broken" }]);
  const seen: string[] = [];
  const step = (reply: string) => (ctx: { messages: unknown[] }) => {
    seen.push(JSON.stringify(ctx.messages.at(-1)));
    return say(reply);
  };
  faux.setResponses([writeCall(), step("first"), step("second"), step("third")]);
  const out = await dispatch("implementer", runner.run);
  assert.equal(runner.calls.length, 3);
  assert.match(out, /^third\n\nVerify: failed after 3 attempts \(pnpm typecheck\)/);
  assert.match(seen[1]!, /Verification failed/);
  assert.match(seen[1]!, /TS2322 broken/);
  assert.ok(seen[1]!.length < 5500, "the output is truncated to its tail");
});

test("a failure that the child fixes ends as passed", async () => {
  writeConfig({ commands: ["pnpm test"] });
  const runner = fakeRunner([{ code: 1, output: "1 failing" }, { code: 0 }]);
  faux.setResponses([writeCall(), say("first"), say("fixed")]);
  assert.match(await dispatch("implementer", runner.run), /^fixed\n\nVerify: passed/);
  assert.equal(runner.calls.length, 2);
});

test("an untrusted project's verify.json is ignored; trust is checked on every use", async () => {
  writeConfig({ commands: ["untrusted-cmd"] });
  store.setProjectTrusted(project.id, false);
  const runner = fakeRunner([{}]);
  faux.setResponses([writeCall(), say("report")]);
  const out = await dispatch("implementer", runner.run);
  assert.ok(!out.includes("Verify"));
  assert.equal(runner.calls.length, 0);
  store.setProjectTrusted(project.id, true);
  faux.setResponses([writeCall(), say("report")]);
  assert.match(await dispatch("implementer", runner.run), /Verify: passed/);
});

test("HostConfig.verify is the default when the project has no file; the project file wins", async () => {
  store.setProjectTrusted(project.id, false);
  store.patchConfig({ verify: { commands: ["user-default"] } });
  writeConfig({ commands: ["pnpm test"] });
  const runner = fakeRunner([{}]);
  faux.setResponses([writeCall(), say("report")]);
  await dispatch("implementer", runner.run);
  assert.deepEqual(runner.calls.map((c) => c.command), ["user-default"]);
  store.setProjectTrusted(project.id, true);
  faux.setResponses([writeCall(), say("report")]);
  await dispatch("implementer", runner.run);
  assert.deepEqual(runner.calls.map((c) => c.command), ["user-default", "pnpm test"]);
  store.patchConfig({ verify: undefined });
});

test("a command denied by the bash policy is not run and is reported as skipped", async () => {
  const rules = compileToolRules({ version: 1, tools: { bash: { deny: ["rm *"] } } })!;
  const runner = fakeRunner([{}]);
  const config = parseVerifyConfig({ commands: ["pnpm typecheck", "rm -rf dist"] })!;
  assert.deepEqual(await runVerify(config, projectDir, rules, runner.run), { status: "skipped", reason: "blocked by policy" });
  assert.equal(runner.calls.length, 0, "nothing runs, not even the allowed command before it");
});

test("a child that made no file edits skips verify", async () => {
  const runner = fakeRunner([{}]);
  faux.setResponses([say("nothing to change")]);
  const out = await dispatch("implementer", runner.run);
  assert.ok(!out.includes("Verify"));
  assert.equal(runner.calls.length, 0);
});

test("a read-only role or approval mode skips verify", async () => {
  const runner = fakeRunner([{}]);
  faux.setResponses([say("read only report")]);
  assert.ok(!(await dispatch("explorer", runner.run)).includes("Verify"));

  faux.setResponses([writeCall(), () => (store.patchConfig({ approvalMode: "read-only" }), say("report"))]);
  const out = await dispatch("implementer", runner.run);
  store.patchConfig({ approvalMode: "full-access" });
  assert.match(out, /Verify: skipped \(read-only approval mode\)/);
  assert.equal(runner.calls.length, 0);
});

test("parseVerifyConfig applies defaults and rejects malformed input", () => {
  assert.deepEqual(parseVerifyConfig({ commands: [" a ", "", 3] }), { commands: ["a"], timeoutSec: 600, maxAttempts: 2 });
  assert.equal(parseVerifyConfig({ commands: [] }), undefined);
  assert.equal(parseVerifyConfig("nope"), undefined);
  assert.equal(parseVerifyConfig({ commands: ["a"], maxAttempts: -1 })?.maxAttempts, 2);
});
