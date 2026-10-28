// Harness-preset evaluation: runs fixed coding tasks through a real ThreadManager under different HostConfig
// fragments ("presets") and reports pass rate, cost, tokens and time. Everything happens in temp copies.
// This file never imports the host. Each run executes in its own child process (run-one.ts) with a fresh
// PISTA_HOME, Pi agent dir and memory dir, because the host reads those at import time.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatMessage } from "@pista/protocol";
import { spawnGroup } from "../process-group.ts";

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
  /** Tail of the check's output, kept only when the check failed. */
  checkOutput?: string;
  error?: string;
}

export interface Summary {
  preset: string;
  runs: number;
  passRate: number;
  meanCostUsd: number;
  meanTokens: number;
  meanSeconds: number;
  /** Mean `agent` tool calls per run (parent and children). */
  meanSubAgentCalls: number;
  /** Verify-gate outcomes summed over all runs (from the sub-agent results' "Verify: ..." lines). */
  verify: { passed: number; failed: number; skipped: number };
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

export type Msg = ChatMessage & { toolName?: string };

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
  /** Real runs only: "provider/id", checked against the model registry before the first run. */
  model?: string;
  /** Abort the remaining runs once the reported cost exceeds this. Required unless `fake`. */
  maxUsd?: number;
  /** Per-run wall-clock limit (default 10 min). The thread is aborted and the run recorded with error "timeout". */
  runTimeoutSec?: number;
  fake?: boolean;
  /** Test only: the fake model never answers, so the run must time out. */
  fakeHang?: boolean;
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

/** What run-one.ts receives (JSON in argv[2]). Paths point into the scratch dir, never into the repo. */
export interface ChildJob {
  mode: "run" | "check-model";
  preset: Pick<Preset, "name" | "config" | "verify"> & { agentsDir?: string };
  task: string;
  prompt: string;
  check: string;
  stageDir: string;
  workDir: string;
  model?: { provider: string; id: string };
  fake: boolean;
  fakeHang: boolean;
  timeoutMs: number;
  /** Where the parent reports the scratch dir for signal cleanup. */
  scratch: string;
}

export const RESULT_MARK = "__EVAL_RESULT__ ";

function count(rs: RunResult[], re: RegExp): number {
  return rs.reduce((n, r) => n + r.verifyLines.filter((l) => re.test(l)).length, 0);
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
      meanSubAgentCalls: mean((r) => r.subAgentCalls),
      verify: {
        passed: count(rs, /verify: passed/i),
        failed: count(rs, /verify: failed/i),
        skipped: count(rs, /verify: skipped/i),
      },
    };
  });
}

export function toMarkdown(report: EvalReport): string {
  const lines = [
    `# Preset eval${report.fake ? " (fake model)" : ""}`,
    "",
    "| preset | runs | pass rate | mean cost (USD) | mean tokens | mean time (s) | mean sub-agent calls | verify pass/fail/skip |",
    "|---|---|---|---|---|---|---|---|",
    ...report.summary.map(
      (s) =>
        `| ${s.preset} | ${s.runs} | ${(s.passRate * 100).toFixed(0)}% | ${s.meanCostUsd.toFixed(4)} | ${Math.round(s.meanTokens)} | ${s.meanSeconds.toFixed(1)} | ${s.meanSubAgentCalls.toFixed(1)} | ${s.verify.passed}/${s.verify.failed}/${s.verify.skipped} |`,
    ),
    "",
    `Total reported cost: ${report.totalCostUsd.toFixed(4)} USD${report.maxUsd !== undefined ? ` (cap ${report.maxUsd})` : ""}.`,
  ];
  const errors = report.results.filter((r) => r.error);
  if (errors.length) lines.push("", `Runs with errors: ${errors.length} of ${report.results.length} (${[...new Set(errors.map((r) => r.error))].join("; ")})`);
  if (report.aborted) lines.push("", `Aborted: ${report.aborted}`);
  return lines.join("\n") + "\n";
}

/** True when the report should make the CLI exit nonzero: it was aborted, or every run errored. */
export function failed(report: EvalReport): boolean {
  return !!report.aborted || (report.results.length > 0 && report.results.every((r) => r.error));
}

const needNumber = (name: string, v: number | undefined, opts: { int?: boolean } = {}) => {
  if (v === undefined) return;
  if (!Number.isFinite(v) || v <= 0 || (opts.int && !Number.isInteger(v))) throw new Error(`${name} must be a positive${opts.int ? " integer" : " number"}`);
};

/** The user's Pi agent dir, resolved like Pista does (PI_CODING_AGENT_DIR, else $PISTA_HOME/pi, else ~/.pista/pi). */
export function realAgentDir(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PI_CODING_AGENT_DIR ?? join(env.PISTA_HOME ?? join(homedir(), ".pista"), "pi")).replace(/^~(?=$|\/)/, homedir());
}

/** Env vars the child may inherit: basics plus provider API keys. Everything else (PISTA_*, PI_*, NODE_OPTIONS, ...) is dropped. */
const ENV_KEEP = /^(PATH|HOME|TMPDIR|SHELL|LANG|LC_[A-Z_]+|USER|LOGNAME|TERM|[A-Z0-9_]+_API_KEY|AWS_[A-Z_]+|GOOGLE_APPLICATION_CREDENTIALS|AZURE_[A-Z_]+|GOOGLE_CLOUD_[A-Z_]+)$/;
export function childEnv(base: NodeJS.ProcessEnv, over: { home: string; agent: string; memory: string }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && ENV_KEEP.test(k)) env[k] = v;
  return { ...env, PISTA_HOME: over.home, PI_CODING_AGENT_DIR: over.agent, PI_MEMORY_DIR: over.memory };
}

/** The child currently running and the scratch dir, so a signal handler can clean up. */
let active: { kill(): void; scratch: string } | undefined;
export function abortEval(): void {
  active?.kill();
  if (active) rmSync(active.scratch, { recursive: true, force: true });
}

/** Child budget: run timeout + the check's 120 s; the parent kills only after that plus slack. */
export const CHECK_TIMEOUT_MS = 120_000;
/** How much of a failed check's output the report keeps. */
export const CHECK_OUTPUT_CHARS = 2000;
export const KILL_SLACK_MS = 30_000;
export const AGENT_DONE = "__AGENT_DONE__";

/** Starts the child detached (own process group) and kills the whole group on timeout; the group kill is skipped on Windows. */
function spawnChild(job: ChildJob, env: NodeJS.ProcessEnv, killAfterMs: number, onAgentDone?: () => void): Promise<{ code: number | null; out: string; err: string; timedOut: boolean }> {
  const hostDir = fileURLToPath(new URL("../..", import.meta.url));
  const entry = fileURLToPath(new URL("./run-one.ts", import.meta.url));
  return new Promise((resolve) => {
    const { child, kill } = spawnGroup(process.execPath, ["--import", "tsx", entry, JSON.stringify(job)], { cwd: hostDir, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let signalled = false;
    let timedOut = false;
    child.stdout!.on("data", (d) => {
      out += d;
      if (!signalled && out.includes(AGENT_DONE)) {
        signalled = true;
        onAgentDone?.();
      }
    });
    child.stderr!.on("data", (d) => (err = (err + d).slice(-2048)));
    active = { kill, scratch: job.scratch };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, killAfterMs);
    child.on("error", () => resolve({ code: 1, out, err, timedOut }));
    child.on("close", (code) => {
      clearTimeout(timer);
      kill(); // stragglers of the agent's own shell commands
      active = undefined;
      resolve({ code, out, err, timedOut });
    });
  });
}

export const parseResult = (out: string): RunResult | undefined => {
  try {
    const line = out.split("\n").reverse().find((l) => l.startsWith(RESULT_MARK));
    const r = line ? (JSON.parse(line.slice(RESULT_MARK.length)) as RunResult) : undefined;
    return r && typeof r === "object" && typeof r.pass === "boolean" ? r : undefined;
  } catch {
    return undefined;
  }
};

/** Runs every preset x task x run sequentially, each in a child process with fresh state. Never reads the user's PISTA_HOME. */
export async function runEval(opts: EvalOptions): Promise<EvalReport> {
  needNumber("--runs", opts.runs, { int: true });
  needNumber("--max-usd", opts.maxUsd);
  needNumber("--run-timeout", opts.runTimeoutSec);
  if (!opts.fake && opts.maxUsd === undefined) throw new Error("--max-usd is required (and must be positive) for real runs");
  if (!opts.fake && !opts.model) throw new Error("--model provider/id is required for real runs");
  const presets = opts.presets.map((p) => loadPreset(opts.presetsDir, p));
  const tasks = loadTasks(opts.tasksDir, opts.tasks);
  const timeoutMs = (opts.runTimeoutSec ?? 600) * 1000;
  let ref: ChildJob["model"];
  if (!opts.fake) {
    const [provider, ...rest] = opts.model!.split("/");
    ref = { provider: provider!, id: rest.join("/") };
  }
  const realDir = opts.fake ? undefined : realAgentDir();
  const scratch = mkdtempSync(join(tmpdir(), "pista-eval-"));

  // Fresh state per run: own PISTA_HOME, agent dir and memory dir. Only auth (and the model store) is copied in for real runs.
  const freshEnv = (dir: string): NodeJS.ProcessEnv => {
    const agent = join(dir, "agent");
    mkdirSync(agent, { recursive: true });
    if (realDir) for (const f of ["auth.json", "models-store.json"]) if (existsSync(join(realDir, f))) cpSync(join(realDir, f), join(agent, f));
    return childEnv(process.env, { home: join(dir, "home"), agent, memory: join(dir, "memory") });
  };
  const base = (preset: Preset, task: Task, dir: string): ChildJob => ({
    mode: "run",
    preset: { name: preset.name, config: preset.config, verify: preset.verify, agentsDir: preset.agentsDir ? join(dir, "agents") : undefined },
    task: task.name,
    prompt: task.prompt,
    check: task.check,
    stageDir: join(dir, "stage"),
    workDir: join(dir, "work"),
    model: ref,
    fake: !!opts.fake,
    fakeHang: !!opts.fakeHang,
    timeoutMs,
    scratch,
  });

  const report: EvalReport = { generatedAt: new Date().toISOString(), fake: !!opts.fake, maxUsd: opts.maxUsd, totalCostUsd: 0, results: [], summary: [] };
  try {
    if (!opts.fake) {
      const dir = join(scratch, "preflight");
      const job = { ...base(presets[0]!, tasks[0]!, dir), mode: "check-model" as const };
      const res = await spawnChild(job, freshEnv(dir), 60_000);
      if (res.code !== 0) throw new Error(`Model ${opts.model} is not in the model registry (or no credentials were found in ${realDir}); nothing was run`);
    }
    outer: for (const preset of presets) {
      for (const task of tasks) {
        for (let run = 1; run <= opts.runs; run++) {
          if (opts.maxUsd !== undefined && report.totalCostUsd >= opts.maxUsd) {
            report.aborted = `cumulative cost ${report.totalCostUsd.toFixed(4)} USD reached --max-usd ${opts.maxUsd}; remaining runs skipped`;
            break outer;
          }
          const dir = mkdtempSync(join(scratch, "run-"));
          // Stage fixture, hidden check files and fake solution outside the repo so the workspace never advertises repo paths.
          cpSync(join(task.dir, "fixture"), join(dir, "stage", "fixture"), { recursive: true });
          // Hidden check files are copied in only after the child reports the agent finished (see onAgentDone below).
          if (opts.fake && existsSync(join(task.dir, "fake"))) cpSync(join(task.dir, "fake"), join(dir, "stage", "fake"), { recursive: true });
          if (preset.agentsDir) cpSync(preset.agentsDir, join(dir, "agents"), { recursive: true });
          const started = Date.now();
          const stageChecks = () => {
            for (const f of readdirSync(task.dir)) if (f.startsWith("check.")) cpSync(join(task.dir, f), join(dir, "stage", f));
            writeFileSync(join(dir, "stage", ".ready"), "");
          };
          const res = await spawnChild(base(preset, task, dir), freshEnv(dir), timeoutMs + CHECK_TIMEOUT_MS + KILL_SLACK_MS, stageChecks);
          const empty = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, subAgentCalls: 0, verifyLines: [] };
          const result: RunResult = parseResult(res.out) ?? {
            preset: preset.name, task: task.name, run, pass: false, seconds: (Date.now() - started) / 1000, ...empty,
            error: res.timedOut ? "timeout" : `run process exited with code ${res.code} and no result${res.err ? `: ${res.err}` : ""}`,
          };
          result.run = run;
          report.results.push(result);
          report.totalCostUsd += result.costUsd;
          opts.onRun?.(result);
          rmSync(dir, { recursive: true, force: true });
        }
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  report.summary = summarize(report.results, opts.presets);
  return report;
}
