import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { PipeTransport } from "./pipe.ts";

export class ProfileInUseError extends Error {
  constructor(public profileDir: string) {
    super("Pista's browser profile is already open in another browser window. Close that window and try again.");
    this.name = "ProfileInUseError";
  }
}

export const pistaChromeProfileDir = (pistaHome: string) => join(pistaHome, "chrome-profile");

export type LaunchDeps = {
  spawn?: (command: string, args: string[], options: any) => ChildProcess;
  readLink?: (path: string) => string;
  isAlive?: (pid: number) => boolean;
  mkdir?: (path: string, options: { recursive: true; mode: number }) => void;
  closeTimeoutMs?: number;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
};

const ENV_KEEP = /^(HOME|PATH|USER|LANG|LC_.*|TMPDIR|TEMP|TMP|DISPLAY|WAYLAND_DISPLAY|XDG_.*|DBUS_SESSION_BUS_ADDRESS)$/;
const ENV_KEEP_WIN = /^(SYSTEMROOT|LOCALAPPDATA|APPDATA|PROGRAMFILES.*|PROGRAMW6432|USERPROFILE)$/i;

/** A minimal environment for the browser: no API keys or other secrets from the host process. */
export function browserEnv(env: Record<string, string | undefined>, platform: NodeJS.Platform): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && (ENV_KEEP.test(k) || (platform === "win32" && ENV_KEEP_WIN.test(k)))) out[k] = v;
  }
  return out;
}

const pidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === "EPERM";
  }
};

/** Chrome's `SingletonLock` is a symlink to `<host>-<pid>`; in use when that pid is alive. */
function profileInUse(profileDir: string, deps: LaunchDeps): boolean {
  let target: string;
  try {
    target = (deps.readLink ?? readlinkSync)(join(profileDir, "SingletonLock"));
  } catch {
    return false;
  }
  const pid = Number(target.slice(target.lastIndexOf("-") + 1));
  return Number.isInteger(pid) && pid > 0 && (deps.isAlive ?? pidAlive)(pid);
}

export type LaunchedBrowser = { transport: PipeTransport; process: ChildProcess; close(): Promise<void> };

/**
 * Starts the browser with a dedicated profile and a private CDP pipe (no TCP port).
 * Node's extra stdio pipes also work on Windows (Puppeteer's `pipe: true`); untested here.
 */
export async function launchBrowser(
  options: { browserPath: string; profileDir: string; extraArgs?: string[] },
  deps: LaunchDeps = {},
): Promise<LaunchedBrowser> {
  (deps.mkdir ?? mkdirSync)(options.profileDir, { recursive: true, mode: 0o700 });
  if (profileInUse(options.profileDir, deps)) throw new ProfileInUseError(options.profileDir);
  const args = [
    `--user-data-dir=${options.profileDir}`,
    "--remote-debugging-pipe",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    ...(options.extraArgs ?? []),
  ];
  const platform = deps.platform ?? process.platform;
  const startedAt = Date.now();
  const child = (deps.spawn ?? nodeSpawn)(options.browserPath, args, {
    stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
    env: browserEnv(deps.env ?? process.env, platform),
  });
  const transport = new PipeTransport(child.stdio[3] as Writable, child.stdio[4] as Readable);
  let exited = false;
  const exit = new Promise<void>((resolve) => {
    child.once("exit", (code, signal) => {
      exited = true;
      // Windows (untested): Chrome hands off to a running instance that owns the profile and
      // exits with code 0 almost at once, so an early clean exit means the profile is in use.
      if (platform === "win32" && code === 0 && Date.now() - startedAt < 5000) transport.fail(new ProfileInUseError(options.profileDir));
      else transport.fail(new Error(`The browser exited unexpectedly (${signal ?? `code ${code}`})`));
      resolve();
    });
  });
  let settle!: () => void;
  const failed = new Promise<void>((resolve) => (settle = resolve));
  child.once("error", (e) => {
    exited = true;
    transport.fail(new Error(`Could not start the browser: ${e.message}`));
    settle();
  });

  const close = async () => {
    if (!exited) {
      transport.send("Browser.close").catch(() => {});
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([exit, failed, new Promise<void>((r) => (timer = setTimeout(r, deps.closeTimeoutMs ?? 5000)))]);
      clearTimeout(timer);
      if (!exited) {
        child.kill("SIGKILL");
        await Promise.race([exit, failed, new Promise<void>((r) => setTimeout(r, 1000).unref())]);
      }
    }
    transport.close();
  };
  return { transport, process: child, close };
}
