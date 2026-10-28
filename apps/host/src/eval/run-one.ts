// One eval run in its own process. PISTA_HOME, PI_CODING_AGENT_DIR and PI_MEMORY_DIR are set by the parent (presets.ts)
// to throwaway dirs before this starts, so importing the host here cannot touch the user's state.
// The workspace (job.workDir) is a copy of the fixture; full-access and trust apply to that folder only. This is not
// a sandbox: the agent runs with the user's OS permissions.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostConfig } from "@pista/protocol";
import { registerNebiusProvider } from "../nebius.ts";
import { spawnGroup } from "../process-group.ts";
import { fauxModels } from "./faux-models.ts";
import { AGENT_DONE, CHECK_OUTPUT_CHARS, CHECK_TIMEOUT_MS, type ChildJob, finalText, type Msg, RESULT_MARK, type RunResult, tally } from "./presets.ts";

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

const result: RunResult = { preset: job.preset.name, task: job.task, run: 1, pass: false, seconds: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, subAgentCalls: 0, verifyLines: [] };
const started = Date.now();
const faux = job.fake ? await fauxModels() : undefined;
// Built-in providers are registered by the host at startup (index.ts), not by ModelRuntime itself.
const models = faux?.models ?? (await ModelRuntime.create({ allowModelNetwork: true }));
if (!faux) registerNebiusProvider(models);
const store = new ConfigStore();
const manager = new ThreadManager(store, new Hub(), models);
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
  store.patchConfig({ ...job.preset.config, approvalMode: "full-access", defaultModel: faux?.ref ?? job.model } as Partial<HostConfig>);
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
      // Recursive, so a reference solution can touch nested files (paths stay relative to fake/).
      const files = existsSync(dir) ? readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => statSync(join(dir, f)).isFile()) : [];
      handle.setResponses([...files.map((f) => piAi.fauxAssistantMessage(piAi.fauxToolCall("write", { path: join(job.workDir, f), content: readFileSync(join(dir, f), "utf8") }))), piAi.fauxAssistantMessage("Done.")]);
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
  } else {
    // Hidden until now: tell the parent, which stages the check files and then drops .ready.
    console.log(AGENT_DONE);
    for (let i = 0; i < 600 && !existsSync(join(job.stageDir, ".ready")); i++) await new Promise((r) => setTimeout(r, 50));
    for (const f of readdirSync(job.stageDir)) if (f.startsWith("check.")) cpSync(join(job.stageDir, f), join(job.workDir, f));
    const { code, out } = await sh(job.check, job.workDir, CHECK_TIMEOUT_MS);
    if (code === "timeout") result.error = "check timeout";
    result.pass = code === 0;
    if (!result.pass) result.checkOutput = out;
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
