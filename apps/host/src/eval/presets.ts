// Harness-preset evaluation: runs fixed coding tasks through a real ThreadManager under different HostConfig
// fragments ("presets") and reports pass rate, cost, tokens and time. Everything happens in temp copies.
// Importing this file does not touch PISTA_HOME or the Pi agent dir; `runEval` imports the host lazily, so the
// caller (cli.ts, tests) must set those env vars first.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { ChatMessage, HostConfig } from "@pista/protocol";
import { fauxModels } from "../test-helpers.ts";

export interface Preset {
  name: string;
  description?: string;
  /** HostConfig fragment (agentOverrides, modelTiers, agentRoles, ...), passed to the config store untouched. */
  config: Record<string, unknown>;
  /** Written verbatim to `<workspace>/.pista/verify.json`. */
  verify?: unknown;
  /** Role files copied to `<workspace>/.pista/agents/`. */
  agentsDir?: string;
}

export interface Task {
  name: string;
  dir: string;
  prompt: string;
  /** Hidden check, run in the workspace after the agent finishes; exit 0 passes. The check files are copied in only then. */
  check: string;
}

export interface RunResult {
  preset: string;
  task: string;
  run: number;
  pass: boolean;
  seconds: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Sum of Pi's per-message `usage.cost.total`; 0 when the provider reports none. */
  costUsd: number;
  subAgentCalls: number;
  verifyLines: string[];
  error?: string;
}

export interface Summary {
  preset: string;
  runs: number;
  passRate: number;
  meanCostUsd: number;
  meanTokens: number;
  meanSeconds: number;
}

export function loadPreset(root: string, name: string): Preset {
  const dir = join(root, name);
  const file = join(dir, "preset.json");
  if (!existsSync(file)) throw new Error(`Unknown preset "${name}": expected ${file}`);
  const raw = JSON.parse(readFileSync(file, "utf8")) as { description?: string; config?: Record<string, unknown>; verify?: unknown };
  const agentsDir = join(dir, "agents");
  return { name, description: raw.description, config: raw.config ?? {}, verify: raw.verify, agentsDir: existsSync(agentsDir) ? agentsDir : undefined };
}

/** `pattern` is a task name, a comma list, or `*` / a prefix ending in `*`. */
export function loadTasks(root: string, pattern: string): Task[] {
  const all = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(root, d.name, "task.json"))).map((d) => d.name).sort();
  const wanted = pattern.split(",").map((p) => p.trim()).filter(Boolean);
  const matches = (n: string) => wanted.some((p) => (p.endsWith("*") ? n.startsWith(p.slice(0, -1)) : n === p));
  const names = all.filter(matches);
  if (names.length === 0) throw new Error(`No task matches "${pattern}" in ${root}`);
  return names.map((name) => {
    const dir = join(root, name);
    const { check } = JSON.parse(readFileSync(join(dir, "task.json"), "utf8")) as { check?: string };
    if (!check) throw new Error(`${name}/task.json needs a "check" command`);
    return { name, dir, prompt: readFileSync(join(dir, "task.md"), "utf8"), check };
  });
}

function sh(command: string, cwd: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: "ignore", timeout: timeoutMs });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

type Msg = ChatMessage & { toolName?: string };

/** Token, cost, sub-agent and verify figures for one parent thread and its children. */
export function tally(parent: Msg[], children: Msg[][]): Pick<RunResult, "input" | "output" | "cacheRead" | "cacheWrite" | "costUsd" | "subAgentCalls" | "verifyLines"> {
  const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, subAgentCalls: 0, verifyLines: [] as string[] };
  for (const m of [...parent, ...children.flat()]) {
    if (m.role === "assistant" && m.usage) {
      t.input += m.usage.input || 0;
      t.output += m.usage.output || 0;
      t.cacheRead += m.usage.cacheRead || 0;
      t.cacheWrite += m.usage.cacheWrite || 0;
      t.costUsd += m.usage.cost?.total || 0;
    }
  }
  for (const m of parent) {
    if (m.role === "assistant") t.subAgentCalls += m.content.filter((b) => b.type === "toolCall" && b.name === "agent").length;
    if (m.role === "toolResult") {
      const text = (Array.isArray(m.content) ? m.content : []).map((b) => (b.type === "text" ? b.text : "")).join("\n");
      for (const line of text.split("\n")) if (/^verify\b/i.test(line.replace(/^\W+/, ""))) t.verifyLines.push(line.slice(0, 200));
    }
  }
  return t;
}

export interface EvalOptions {
  presetsDir: string;
  tasksDir: string;
  presets: string[];
  tasks: string;
  runs: number;
  /** Real runs only: "provider/id". */
  model?: string;
  /** Abort the remaining runs once the reported cost exceeds this. Required unless `fake`. */
  maxUsd?: number;
  fake?: boolean;
  /** Called after each run (progress output). */
  onRun?: (r: RunResult) => void;
}

export interface EvalReport {
  generatedAt: string;
  fake: boolean;
  maxUsd?: number;
  totalCostUsd: number;
  aborted?: string;
  results: RunResult[];
  summary: Summary[];
}

export function summarize(results: RunResult[], presets: string[]): Summary[] {
  return presets.map((preset) => {
    const rs = results.filter((r) => r.preset === preset);
    const mean = (f: (r: RunResult) => number) => (rs.length ? rs.reduce((s, r) => s + f(r), 0) / rs.length : 0);
    return {
      preset,
      runs: rs.length,
      passRate: mean((r) => (r.pass ? 1 : 0)),
      meanCostUsd: mean((r) => r.costUsd),
      meanTokens: mean((r) => r.input + r.output + r.cacheRead + r.cacheWrite),
      meanSeconds: mean((r) => r.seconds),
    };
  });
}

export function toMarkdown(report: EvalReport): string {
  const lines = [
    `# Preset eval${report.fake ? " (fake model)" : ""}`,
    "",
    "| preset | runs | pass rate | mean cost (USD) | mean tokens | mean time (s) |",
    "|---|---|---|---|---|---|",
    ...report.summary.map((s) => `| ${s.preset} | ${s.runs} | ${(s.passRate * 100).toFixed(0)}% | ${s.meanCostUsd.toFixed(4)} | ${Math.round(s.meanTokens)} | ${s.meanSeconds.toFixed(1)} |`),
    "",
    `Total reported cost: ${report.totalCostUsd.toFixed(4)} USD${report.maxUsd !== undefined ? ` (cap ${report.maxUsd})` : ""}.`,
  ];
  if (report.aborted) lines.push("", `Aborted: ${report.aborted}`);
  return lines.join("\n") + "\n";
}

/** Runs every preset x task x run sequentially. PISTA_HOME / PI_CODING_AGENT_DIR must already be set by the caller. */
export async function runEval(opts: EvalOptions): Promise<EvalReport> {
  if (!opts.fake && !(opts.maxUsd !== undefined && opts.maxUsd > 0)) throw new Error("--max-usd is required (and must be positive) for real runs");
  if (!opts.fake && !opts.model) throw new Error("--model provider/id is required for real runs");
  const presets = opts.presets.map((p) => loadPreset(opts.presetsDir, p));
  const tasks = loadTasks(opts.tasksDir, opts.tasks);
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const { ConfigStore } = await import("../config.ts");
  const { Hub } = await import("../hub.ts");
  const { ThreadManager } = await import("../threads.ts");
  const fauxHandle = opts.fake ? await fauxModels() : undefined;
  const models = fauxHandle?.models ?? (await ModelRuntime.create({ allowModelNetwork: true }));
  let ref = fauxHandle?.ref;
  if (!ref) {
    const [provider, ...rest] = opts.model!.split("/");
    ref = { provider: provider!, id: rest.join("/") };
  }

  const report: EvalReport = { generatedAt: new Date().toISOString(), fake: !!opts.fake, maxUsd: opts.maxUsd, totalCostUsd: 0, results: [], summary: [] };
  outer: for (const preset of presets) {
    for (const task of tasks) {
      for (let run = 1; run <= opts.runs; run++) {
        if (opts.maxUsd !== undefined && report.totalCostUsd > opts.maxUsd) {
          report.aborted = `cumulative cost ${report.totalCostUsd.toFixed(4)} USD exceeded --max-usd ${opts.maxUsd}; remaining runs skipped`;
          break outer;
        }
        // The workspace is a throwaway copy of the fixture; full-access and trust apply to this folder only.
        const work = mkdtempSync(join(tmpdir(), `pista-eval-${basename(task.name)}-`));
        const result: RunResult = { preset: preset.name, task: task.name, run, pass: false, seconds: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, subAgentCalls: 0, verifyLines: [] };
        const started = Date.now();
        const store = new ConfigStore();
        const hub = new Hub();
        const manager = new ThreadManager(store, hub, models);
        try {
          cpSync(join(task.dir, "fixture"), work, { recursive: true });
          if (preset.verify !== undefined) {
            mkdirSync(join(work, ".pista"), { recursive: true });
            writeFileSync(join(work, ".pista", "verify.json"), JSON.stringify(preset.verify));
          }
          if (preset.agentsDir) cpSync(preset.agentsDir, join(work, ".pista", "agents"), { recursive: true });
          const project = store.addProject(work);
          store.setProjectTrusted(project.id, true);
          // Reset every key a preset may set so one run cannot leak into the next.
          store.patchConfig({ agentOverrides: undefined, agentRoles: undefined, modelTiers: undefined, ...preset.config, approvalMode: "full-access", defaultModel: ref } as Partial<HostConfig>);
          const { summary } = await manager.create(project.id);
          if (fauxHandle) scriptFake(fauxHandle, task, work);
          const { run: done } = await manager.startPrompt(summary.id, task.prompt, undefined);
          await done;
          // Hidden check files are copied in only now, so the agent never sees them.
          for (const f of readdirSync(task.dir)) if (f.startsWith("check.")) cpSync(join(task.dir, f), join(work, f));
          result.pass = (await sh(task.check, work, 120_000)) === 0;
          const parentMsgs = (await manager.open(summary.id)).messages as Msg[];
          const kids = (await manager.list()).filter((t) => t.parentId === summary.id);
          const childMsgs = await Promise.all(kids.map(async (k) => (await manager.continueChild(k.id)).session.messages as unknown as Msg[]));
          Object.assign(result, tally(parentMsgs, childMsgs));
        } catch (error) {
          result.error = error instanceof Error ? error.message : String(error);
        } finally {
          result.seconds = (Date.now() - started) / 1000;
          manager.dispose();
          rmSync(work, { recursive: true, force: true });
        }
        report.results.push(result);
        report.totalCostUsd += result.costUsd;
        opts.onRun?.(result);
      }
    }
  }
  report.summary = summarize(report.results, opts.presets);
  return report;
}

/** Scripts the faux model to write the task's `fake/` solution files, then finish. */
function scriptFake(handle: NonNullable<Awaited<ReturnType<typeof fauxModels>>> , task: Task, work: string) {
  const { piAi, faux } = handle;
  const dir = join(task.dir, "fake");
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const steps = files.map((f) => piAi.fauxAssistantMessage(piAi.fauxToolCall("write", { path: join(work, f), content: readFileSync(join(dir, f), "utf8") })));
  faux.setResponses([...steps, piAi.fauxAssistantMessage("Done.")]);
}
