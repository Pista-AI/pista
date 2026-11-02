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
};

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
  const child = (deps.spawn ?? nodeSpawn)(options.browserPath, args, { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const transport = new PipeTransport(child.stdio[3] as Writable, child.stdio[4] as Readable);
  let exited = false;
  const exit = new Promise<void>((resolve) => {
    child.once("exit", (code, signal) => {
      exited = true;
      transport.fail(new Error(`The browser exited unexpectedly (${signal ?? `code ${code}`})`));
      resolve();
    });
  });
  child.once("error", (e) => transport.fail(new Error(`Could not start the browser: ${e.message}`)));

  const close = async () => {
    if (!exited) {
      transport.send("Browser.close").catch(() => {});
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([exit, new Promise<void>((r) => (timer = setTimeout(r, deps.closeTimeoutMs ?? 5000)))]);
      clearTimeout(timer);
      if (!exited) child.kill("SIGKILL");
    }
    transport.close();
  };
  return { transport, process: child, close };
}
