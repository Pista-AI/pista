import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostConfig } from "@pista/protocol";
import { type ConfigStore, WORKSPACE_DIR } from "./config.ts";
import type { ToolRules } from "./policy-tools.ts";
import { spawnGroup } from "./process-group.ts";
import { resolveProjectTrust } from "./project-trust.ts";

export const DEFAULT_VERIFY_TIMEOUT_SEC = 600;
export const DEFAULT_VERIFY_ATTEMPTS = 2;
/** The tail of a failing command's output that goes back to the model. */
export const VERIFY_OUTPUT_CHARS = 4000;

/** `<project>/.pista/verify.json`, or `HostConfig.verify`. */
export interface VerifyConfig {
  commands: string[];
  timeoutSec: number;
  maxAttempts: number;
}

export interface CommandResult {
  code: number | null;
  output: string;
  timedOut: boolean;
}

/** Runs one shell command in `cwd`; replaced by a fake in tests. */
export type CommandRunner = (command: string, opts: { cwd: string; timeoutMs: number; signal?: AbortSignal }) => Promise<CommandResult>;

export type VerifyOutcome = { status: "passed" } | { status: "failed"; command: string; output: string } | { status: "skipped"; reason: string };

/** What the verify gate needs from the host; narrow so tests can stub it. */
export interface VerifyDeps {
  store: Pick<ConfigStore, "config" | "projects" | "toolRules">;
  /** Defaults to a real shell. */
  run?: CommandRunner;
}

/** A usable config from untrusted JSON, or undefined when it is malformed or has no commands. */
export function parseVerifyConfig(raw: unknown): VerifyConfig | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { commands, timeoutSec, maxAttempts } = raw as Record<string, unknown>;
  if (!Array.isArray(commands)) return undefined;
  const list = commands.filter((c): c is string => typeof c === "string" && c.trim() !== "").map((c) => c.trim());
  if (list.length === 0) return undefined;
  const positive = (v: unknown, fallback: number) => (Number.isSafeInteger(v) && (v as number) > 0 ? (v as number) : fallback);
  return { commands: list, timeoutSec: positive(timeoutSec, DEFAULT_VERIFY_TIMEOUT_SEC), maxAttempts: positive(maxAttempts, DEFAULT_VERIFY_ATTEMPTS) };
}

/**
 * The verify config for `cwd`: the project's `.pista/verify.json` (read only when the project is trusted, checked
 * on every call) over `HostConfig.verify`. An untrusted project's file is ignored, not an error.
 */
export function resolveVerifyConfig(store: VerifyDeps["store"], cwd: string): VerifyConfig | undefined {
  if (resolveProjectTrust(cwd, store.projects, WORKSPACE_DIR).trusted) {
    try {
      const project = parseVerifyConfig(JSON.parse(readFileSync(join(cwd, ".pista", "verify.json"), "utf8")));
      if (project) return project;
    } catch {
      // Missing or unreadable file: fall back to the user-level default.
    }
  }
  return parseVerifyConfig((store.config as Partial<HostConfig>).verify);
}

/** Runs the commands in order and stops at the first failure. Every command is policy-checked before any runs. */
export async function runVerify(config: VerifyConfig, cwd: string, rules: ToolRules | null, run: CommandRunner, signal?: AbortSignal): Promise<VerifyOutcome> {
  for (const command of config.commands) {
    if (rules?.checkBash(command)) return { status: "skipped", reason: "blocked by policy" };
  }
  for (const command of config.commands) {
    const result = await run(command, { cwd, timeoutMs: config.timeoutSec * 1000, signal });
    if (result.timedOut || result.code !== 0) {
      const tail = result.output.length > VERIFY_OUTPUT_CHARS ? `...${result.output.slice(-VERIFY_OUTPUT_CHARS)}` : result.output;
      const why = result.timedOut ? `timed out after ${config.timeoutSec}s` : `exited with code ${result.code}`;
      return { status: "failed", command, output: `$ ${command}\n${why}\n${tail}`.trim() };
    }
  }
  return { status: "passed" };
}

/** Same string for the same effective config; compares the config before and after a child's run. */
export const verifyKey = (config: VerifyConfig | undefined) => JSON.stringify(config ?? null);

const locks = new Map<string, Promise<unknown>>();
/** Runs `fn` after every earlier call for the same project finished, so concurrent children do not run checks at once. */
export function withProjectLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
  const tail = next.catch(() => {});
  locks.set(key, tail);
  void tail.then(() => locks.get(key) === tail && locks.delete(key));
  return next;
}

/** How long to wait for output streams after the shell exited or was killed. */
const EXIT_GRACE_MS = 200;

/** Shell command with the project as cwd, in its own process group so a timeout or stop kills what it started too. Output is capped as it arrives. */
export const shellRunner: CommandRunner = (command, { cwd, timeoutMs, signal }) =>
  new Promise((resolve) => {
    const { child, kill } = spawnGroup(command, [], { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timedOut = false;
    let done = false;
    const take = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-VERIFY_OUTPUT_CHARS * 4);
    };
    child.stdout!.on("data", take);
    child.stderr!.on("data", take);
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ code, output, timedOut });
    };
    // Do not wait for `close`: a background process holding the pipes open would hang it.
    const settle = (code: number | null) => void setTimeout(() => finish(code), EXIT_GRACE_MS);
    const onAbort = () => {
      kill();
      settle(null);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
      settle(null);
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (error) => {
      output += String(error.message);
      finish(1);
    });
    child.on("exit", (code) => settle(code));
    child.on("close", (code) => finish(code));
  });

export const feedbackPrompt = (output: string) => `Verification failed. Fix the problems below, then finish again with your report.\n\n${output}`;
