// One eval run in its own process. PISTA_HOME, PI_CODING_AGENT_DIR and PI_MEMORY_DIR are set by the parent (presets.ts)
// to throwaway dirs before this starts, so importing the host here cannot touch the user's state.
// The workspace (job.workDir) is a copy of the fixture; full-access and trust apply to that folder only. This is not
// a sandbox: the agent runs with the user's OS permissions.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostConfig } from "@pista/protocol";
import { registerNebiusProvider } from "../nebius.ts";
import { spawnGroup } from "../process-group.ts";
import { workspaceDiff } from "./diff.ts";
import { type FakeFile, fakeFallsBackToSolo, fakeFiles, fakeReport, fakeSlices, sliceFiles, slicedFake } from "./fake-solution.ts";
import { fauxModels } from "./faux-models.ts";
import { parentModel } from "./parent-model.ts";
import { AGENT_DONE, CHECK_OUTPUT_CHARS, CHECK_TIMEOUT_MS, type ChildJob, finalText, fixturePaths, JUDGE_SYSTEM, JUDGE_TIMEOUT_MS, judgePrompt, type Msg, parseJudge, parseSubtests, RESULT_MARK, type RunResult, tally } from "./presets.ts";

const job = JSON.parse(process.argv[2]!) as ChildJob;

/** Runs the check in its own process group and kills the group on timeout (group kill skipped on Windows). */
/** Runs `command`; `out` is the tail of its combined stdout/stderr. */
function sh(command: string, cwd: string, timeoutMs: number): Promise<{ code: number | "timeout"; out: string }> {
  return new Promise((resolve) => {
    const { child, kill } = spawnGroup(command, [], { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const keep = (d: Buffer) => (out = (out + d.toString()).slice(-CHECK_OUTPUT_CHARS));
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    child.on("error", (e) => resolve({ code: 1, out: String(e) }));
    child.on("close", (code) => {
      clearTimeout(timer);
      kill();
      resolve({ code: timedOut ? "timeout" : (code ?? 1), out });
    });
  });
}

async function takeDiff(): Promise<void> {
  try {
    const d = await workspaceDiff(join(job.stageDir, "fixture"), job.workDir);
    Object.assign(result, { diff: d.diff, diffStats: d.stats });
  } catch (error) {
    result.diffError = error instanceof Error ? error.message : String(error);
  }
}

/** One blind reviewer call: the task and the diff only. Records `quality` or `judgeError`, and the call's cost. */
async function review(runtime: typeof models, ref: { provider: string; id: string }): Promise<void> {
  const model = runtime.getModel(ref.provider, ref.id);
  if (!model) return void (result.judgeError = `reviewer model ${ref.provider}/${ref.id} not found`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
  try {
    // Paths of the original fixture (not the workspace, which holds the agent's edits), so the reviewer can spot reuse.
    const content = judgePrompt(job.prompt, result.diff!, fixturePaths(join(job.stageDir, "fixture")));
    const reply = await runtime.completeSimple(model, { systemPrompt: JUDGE_SYSTEM, messages: [{ role: "user", content, timestamp: Date.now() }] }, { maxTokens: 16000, ...(model.reasoning ? { reasoning: "minimal" as const } : {}), signal: controller.signal });
    result.judgeCostUsd += reply.usage?.cost?.total || 0;
    if (reply.stopReason === "aborted") throw new Error("reviewer timed out");
    if (reply.stopReason === "length" || reply.stopReason === "error") throw new Error(`reviewer stopped: ${reply.stopReason}${reply.errorMessage ? ` (${reply.errorMessage})` : ""}`);
    const parsed = parseJudge(reply.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
    if ("quality" in parsed) result.quality = parsed.quality;
    else result.judgeError = parsed.error;
  } catch (error) {
    result.judgeError = error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timer);
  }
}

if (job.mode === "check-model") {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const models = await ModelRuntime.create({ allowModelNetwork: false });
  registerNebiusProvider(models);
  process.exit(models.getModel(job.model!.provider, job.model!.id) ? 0 : 1);
}

const { ConfigStore } = await import("../config.ts");
const { Hub } = await import("../hub.ts");
const { ThreadManager } = await import("../threads.ts");
const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");

const result: RunResult = { preset: job.preset.name, task: job.task, run: 1, pass: false, seconds: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, subAgentCalls: 0, verifyLines: [], diffStats: { files: 0, added: 0, removed: 0 }, judgeCostUsd: 0 };
const started = Date.now();
const faux = job.fake ? await fauxModels() : undefined;
// Built-in providers are registered by the host at startup (index.ts), not by ModelRuntime itself.
const models = faux?.models ?? (await ModelRuntime.create({ allowModelNetwork: true }));
const windowCap = job.preset.config.contextWindowCap;
if (windowCap !== undefined && (typeof windowCap !== "number" || !Number.isInteger(windowCap) || windowCap <= 0)) throw new Error(`preset ${job.preset.name}: contextWindowCap must be a positive integer`);
if (!faux) registerNebiusProvider(models, windowCap);
const store = new ConfigStore();
const hub = new Hub();
const emit = hub.emit.bind(hub);
hub.emit = (event) => {
  // The loop guard says why it stopped a thread (parent or sub-agent) only in a toast.
  if (event.type === "toast" && event.message.startsWith("Stopped ")) (result.guardStops ??= []).push(event.message.slice(0, 200));
  emit(event);
};
const manager = new ThreadManager(store, hub, models);
let threadId: string | undefined;
try {
  cpSync(join(job.stageDir, "fixture"), job.workDir, { recursive: true });
  if (job.preset.verify !== undefined) {
    mkdirSync(join(job.workDir, ".pista"), { recursive: true });
    writeFileSync(join(job.workDir, ".pista", "verify.json"), JSON.stringify(job.preset.verify));
  }
  if (job.preset.agentsDir) cpSync(job.preset.agentsDir, join(job.workDir, ".pista", "agents"), { recursive: true });
  const project = store.addProject(job.workDir);
  store.setProjectTrusted(project.id, true);
  const parent = parentModel(job.preset, faux?.ref, job.model);
  if (parent) result.model = `${parent.provider}/${parent.id}`;
  store.patchConfig({ ...job.preset.config, approvalMode: "full-access", defaultModel: parent } as Partial<HostConfig>);
  threadId = (await manager.create(project.id)).summary.id;
  if (faux) {
    const { piAi, faux: handle } = faux;
    if (job.fakeHang) {
      // Never answers until the run is aborted, like a stuck provider.
      handle.setResponses([async (_c: unknown, o?: { signal?: AbortSignal }) => {
        await new Promise<void>((r) => o?.signal?.addEventListener("abort", () => r(), { once: true }));
        return piAi.fauxAssistantMessage("aborted");
      }]);
    } else {
      const dir = join(job.stageDir, "fake");
      const write = (f: FakeFile) => piAi.fauxAssistantMessage(piAi.fauxToolCall("write", { path: join(job.workDir, f.path), content: f.content }));
      const sliced = slicedFake(job.preset.config as Partial<HostConfig>, dir) ? fakeSlices(dir)! : undefined;
      // The reviewer call (after the agent) takes the last response.
      const verdict = (s: number) => ({ spec: { score: s, reason: "fake" }, minimal: { score: s, reason: "fake" }, readable: { score: s, reason: "fake" }, safe: { score: s, reason: "fake" }, structure: { score: s, reason: "fake" } });
      // One global queue, consumed in call order. Sliced: the parent's `slices` call, then each slice's child (writes, then its
      // report) in dependency order, then the parent's answer. If the harness will go solo (too few slices) the parent writes everything itself.
      const solo = sliced && fakeFallsBackToSolo(job.preset.config as Partial<HostConfig>, sliced.payload);
      const script =
        sliced && !solo
          ? [
              piAi.fauxAssistantMessage(piAi.fauxToolCall("slices", sliced.payload)),
              ...sliced.order.flatMap((id) => {
                const own = sliceFiles(dir, id);
                return [...own.map(write), piAi.fauxAssistantMessage(fakeReport(id, own))];
              }),
              piAi.fauxAssistantMessage("Done: all slices verified."),
            ]
          : [...(sliced ? [piAi.fauxAssistantMessage(piAi.fauxToolCall("slices", sliced.payload))] : []), ...fakeFiles(dir).map(write), piAi.fauxAssistantMessage("Done.")];
      handle.setResponses([
        ...script,
        ...(job.judge ? [piAi.fauxAssistantMessage(`Review:\n${JSON.stringify(verdict(4))}`)] : []),
      ]);
    }
  }
  const { run } = await manager.startPrompt(threadId, job.prompt, undefined);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((r) => (timer = setTimeout(() => r("timeout"), job.timeoutMs)));
  const outcome = await Promise.race([run.then(() => "done" as const), timeout]);
  clearTimeout(timer);
  if (outcome === "timeout") {
    result.error = "timeout";
    await manager.abort(threadId).catch(() => {});
    run.catch(() => {});
    await takeDiff();
  } else {
    // Hidden until now: tell the parent, which stages the check files and then drops .ready.
    await takeDiff();
    console.log(AGENT_DONE);
    for (let i = 0; i < 600 && !existsSync(join(job.stageDir, ".ready")); i++) await new Promise((r) => setTimeout(r, 50));
    for (const f of readdirSync(job.stageDir)) if (f.startsWith("check.")) cpSync(join(job.stageDir, f), join(job.workDir, f));
    const { code, out } = await sh(job.check, job.workDir, CHECK_TIMEOUT_MS);
    if (code === "timeout") result.error = "check timeout";
    result.pass = code === 0;
    if (!result.pass) result.checkOutput = out;
    result.subtests = parseSubtests(out);
    if (job.judge) {
      // No paid call for a broken run or when there is nothing to review.
      const skip = result.error ? "run errored" : result.diffError ? "no diff" : result.diffStats.files === 0 ? "empty diff" : undefined;
      if (skip) result.judgeError = `skipped: ${skip}`;
      else await review(models, faux ? faux.ref : job.judge);
    }
  }
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
} finally {
  // Usage counts even when the run errored or timed out.
  try {
    if (threadId) {
      const parent = (await manager.open(threadId)).messages as Msg[];
      const kids = (await manager.list()).filter((t) => t.parentId === threadId);
      const childMsgs = await Promise.all(kids.map(async (k) => (await manager.continueChild(k.id)).session.messages as unknown as Msg[]));
      Object.assign(result, tally(parent, childMsgs));
      result.finalText = finalText(parent);
    }
  } catch {}
  result.seconds = (Date.now() - started) / 1000;
  manager.dispose();
  console.log(RESULT_MARK + JSON.stringify(result));
  process.exit(0);
}
