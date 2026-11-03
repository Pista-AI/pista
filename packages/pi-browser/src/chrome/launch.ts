import { execFile, spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readlinkSync, realpathSync, rmSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import { basename, join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { PipeTransport } from "./pipe.ts";
import { ensureProfilePrefs } from "./prefs.ts";

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
  /** How long launch waits for a live lock owner to go away before reporting the profile as in use. */
  lockGraceMs?: number;
  hostname?: () => string;
  /** Command line of a process, or undefined when unknown. */
  commandLine?: (pid: number) => Promise<string | undefined>;
  /** Prepares the profile preferences before launch. */
  prepareProfile?: (profileDir: string) => void;
  killPid?: (pid: number, signal: NodeJS.Signals) => void;
  removeLock?: (path: string) => void;
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

type LockInfo = { pid: number; host: string };

function readLock(profileDir: string, deps: LaunchDeps): LockInfo | undefined {
  let target: string;
  try {
    target = (deps.readLink ?? readlinkSync)(join(profileDir, "SingletonLock"));
  } catch {
    return undefined;
  }
  const i = target.lastIndexOf("-");
  const pid = Number(target.slice(i + 1));
  return Number.isInteger(pid) && pid > 0 ? { pid, host: target.slice(0, i) } : undefined;
}

function trimSlashes(p: string): string {
  let end = p.length;
  while (end > 1 && (p[end - 1] === "/" || p[end - 1] === "\\")) end--;
  return p.slice(0, end);
}

/** The spellings a browser may have been started with: as given and resolved (relative path, /var vs /private/var). */
function profileSpellings(profileDir: string): string[] {
  const out = new Set([trimSlashes(profileDir), trimSlashes(resolve(profileDir))]);
  try {
    out.add(trimSlashes(realpathSync(profileDir)));
  } catch {}
  return [...out];
}

/** True when `command` is a Chromium-family browser started with `--user-data-dir=<profileDir>`. */
export function isBrowserOnProfile(command: string, profileDir: string): boolean {
  // The executable is everything before the first flag; the profile path (which may contain "chrome") is not part of it.
  const exe = basename(command.split(/\s--/)[0] ?? "");
  if (!/chrom|msedge|brave/i.test(exe)) return false;
  for (const dir of profileSpellings(profileDir)) {
    const flag = `--user-data-dir=${dir}`;
    for (let at = command.indexOf(flag); at >= 0; at = command.indexOf(flag, at + 1)) {
      const next = command[at + flag.length];
      if (next === undefined || /\s/.test(next) || next === "/") return true; // not a longer directory name
    }
  }
  return false;
}

/**
 * Chrome's `SingletonLock` is a symlink to `<host>-<pid>`. It is held only while that pid is alive on
 * this host and is still a browser on this profile: a dead pid means a stale lock (Chrome crashed or was killed),
 * and a live pid that runs something else is a pid reused after a reboot. Chrome itself takes over a stale lock.
 * A lock from another host cannot be checked, so it counts as in use, as in Chrome.
 */
async function lockHeld(lock: LockInfo | undefined, profileDir: string, deps: LaunchDeps): Promise<boolean> {
  if (!lock) return false;
  if (lock.host !== (deps.hostname ?? osHostname)()) return true;
  if (!(deps.isAlive ?? pidAlive)(lock.pid)) return false;
  if ((deps.platform ?? process.platform) === "win32") return true; // no command line check there
  const command = await (deps.commandLine ?? defaultCommandLine)(lock.pid);
  return command === undefined || isBrowserOnProfile(command, profileDir); // unknown: assume it is the browser
}

const defaultCommandLine = (pid: number) =>
  new Promise<string | undefined>((resolve) => {
    execFile("ps", ["-o", "command=", "-p", String(pid)], { timeout: 2000 }, (err, out) => resolve(err ? undefined : out.trim() || undefined));
  });

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  // A browser that is still shutting down (just closed by us or the user) gets a short grace period.
  const graceEnd = Date.now() + (deps.lockGraceMs ?? 3000);
  while (await lockHeld(readLock(options.profileDir, deps), options.profileDir, deps)) {
    if (Date.now() >= graceEnd) throw new ProfileInUseError(options.profileDir);
    await sleep(100);
  }
  if (readLock(options.profileDir, deps)) {
    try {
      (deps.removeLock ?? ((p: string) => rmSync(p, { force: true })))(join(options.profileDir, "SingletonLock"));
    } catch {}
  }
  try {
    (deps.prepareProfile ?? ensureProfilePrefs)(options.profileDir);
  } catch {} // best effort: a profile we cannot tune still launches
  const args = [
    `--user-data-dir=${options.profileDir}`,
    "--remote-debugging-pipe",
    "--restore-last-session", // with the restore_on_startup preference, brings back the tabs and session-only cookies
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

  const closeTimeout = deps.closeTimeoutMs ?? 5000;
  const waitExit = async (ms: number) => {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([exit, failed, new Promise<void>((r) => (timer = setTimeout(r, ms)))]);
    clearTimeout(timer);
  };
  const close = async () => {
    if (!exited) {
      transport.send("Browser.close").catch(() => {});
      await waitExit(closeTimeout);
      if (!exited) {
        child.kill("SIGTERM");
        await waitExit(2000);
      }
      if (!exited) {
        child.kill("SIGKILL");
        await waitExit(2000);
      }
    }
    // The main process is gone; the process holding the profile lock (the real browser, if the one we
    // spawned handed off) must be gone too, or a relaunch on this profile would be refused.
    const lock = readLock(options.profileDir, deps);
    if (lock && lock.host === (deps.hostname ?? osHostname)() && lock.pid !== child.pid) {
      const alive = deps.isAlive ?? pidAlive;
      const kill = deps.killPid ?? ((pid, sig) => process.kill(pid, sig));
      const until = Date.now() + closeTimeout;
      while (alive(lock.pid) && Date.now() < until) await sleep(50);
      // Never signal a stranger: the pid may have been reused. Only kill a process that is demonstrably
      // a browser on our profile (never on Windows, where there is no command line check).
      const ours = platform !== "win32" && alive(lock.pid) && isBrowserOnProfile((await (deps.commandLine ?? defaultCommandLine)(lock.pid)) ?? "", options.profileDir);
      if (ours && alive(lock.pid)) {
        try { kill(lock.pid, "SIGKILL"); } catch {}
        const end = Date.now() + 2000;
        while (alive(lock.pid) && Date.now() < end) await sleep(50);
      }
    }
    transport.close();
  };
  return { transport, process: child, close };
}
