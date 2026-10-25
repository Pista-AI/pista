import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

export type ProcessState = "stopped" | "starting" | "running";

/**
 * How to tell the process is ready. `stdout` is called for every complete stdout line and returns the ready value
 * (anything but undefined) once the line says so; `http` polls the URL until it answers with a 2xx status.
 */
export type Readiness<T> = { stdout: (line: string) => T | undefined } | { http: { url: string; intervalMs?: number } };

export interface ProcessSpec<T> {
  command: string;
  args: string[];
  /** Replaces the child's environment; omit to inherit this process's. */
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  ready: Readiness<T>;
}

export interface ManagedProcessOptions<T> {
  /** Describes the process to start. Called on every start, so it can pick a fresh port. */
  launch: () => ProcessSpec<T> | Promise<ProcessSpec<T>>;
  /** Used in the "exited" error message. */
  name?: string;
  /** How long to wait for readiness before killing the process. Default 60 s. */
  readyTimeoutMs?: number;
  /** Stop after this long idle (see `armIdle`). Omit to never idle out. */
  idleMs?: number;
  /** Called when the idle timer fires; defaults to `stop()`. */
  onIdle?: () => void;
  onStateChange?: (state: ProcessState) => void;
  /** Called when a ready process exits on its own (not via `stop()`). */
  onExit?: (info: { code: number | null; signal: NodeJS.Signals | null; stderrTail: string }) => void;
}

export class ReadyTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Process was not ready after ${timeoutMs / 1000} s.`);
  }
}

export class ProcessExitedError extends Error {
  constructor(name: string, readonly code: number | null, readonly stderrTail: string) {
    super(`${name} exited (${code}). ${stderrTail}`);
  }
}

/** A start was cancelled by `stop()`. */
export class ProcessStoppedError extends Error {
  constructor() {
    super("The process was stopped while starting.");
  }
}

/** One lazily started child process with a readiness check, an optional idle timeout and clean stop. */
export class ManagedProcess<T = undefined> {
  private child: ChildProcess | undefined;
  private starting: Promise<T | undefined> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private result: T | undefined;
  private current: ProcessState = "stopped";
  /** Bumped by stop() so an in-flight start can tell it was cancelled. */
  private generation = 0;
  private startGeneration = 0;

  constructor(private options: ManagedProcessOptions<T>) {}

  get state(): ProcessState {
    return this.current;
  }
  get running(): boolean {
    return this.current === "running";
  }
  get pid(): number | undefined {
    return this.child?.pid;
  }

  /** Starts the process if needed (concurrent calls share one start) and resolves with its ready value. */
  ensureRunning(): Promise<T | undefined> {
    if (this.running) return Promise.resolve(this.result);
    if (this.starting && this.startGeneration === this.generation) return this.starting;
    // A start cancelled by stop() may still be settling; let it finish, then start fresh.
    const stale = this.starting;
    const generation = this.generation;
    const promise: Promise<T | undefined> = (async () => {
      await stale?.catch(() => {});
      return this.start(generation);
    })().finally(() => {
      if (this.starting === promise) this.starting = undefined;
    });
    this.startGeneration = generation;
    this.starting = promise;
    return promise;
  }

  /** Kills the process (or cancels a start in progress). Safe to call at any time. */
  stop() {
    this.generation++;
    clearTimeout(this.idleTimer);
    const child = this.child;
    this.child = undefined;
    this.result = undefined;
    child?.kill();
    this.setState("stopped");
  }

  /** Cancels the idle timer, e.g. while a request is in flight. */
  pauseIdle() {
    clearTimeout(this.idleTimer);
  }

  /** (Re)starts the idle timer; when it fires the process is stopped. */
  armIdle() {
    clearTimeout(this.idleTimer);
    if (this.options.idleMs === undefined) return;
    this.idleTimer = setTimeout(() => (this.options.onIdle ?? (() => this.stop()))(), this.options.idleMs);
    this.idleTimer.unref?.();
  }

  private setState(state: ProcessState) {
    if (state === this.current) return;
    this.current = state;
    this.options.onStateChange?.(state);
  }

  private async start(generation: number): Promise<T | undefined> {
    if (generation !== this.generation) throw new ProcessStoppedError();
    this.setState("starting");
    try {
      const spec = await this.options.launch();
      if (generation !== this.generation) throw new ProcessStoppedError();
      const child = spawn(spec.command, spec.args, { stdio: ["ignore", "pipe", "pipe"], env: spec.env, cwd: spec.cwd });
      this.child = child;
      let stderrTail = "";
      child.stderr!.on("data", (d) => (stderrTail = (stderrTail + d).slice(-4000)));
      const value = await this.waitReady(child, spec.ready, generation);
      this.result = value;
      child.once("exit", (code, signal) => {
        if (this.child !== child) return;
        this.child = undefined;
        this.result = undefined;
        clearTimeout(this.idleTimer);
        this.options.onExit?.({ code, signal, stderrTail: stderrTail.trim() }); // before the state change, so listeners can record why
        this.setState("stopped");
      });
      this.setState("running");
      return value;
    } catch (error) {
      if (generation === this.generation) {
        this.child?.kill();
        this.child = undefined;
        this.setState("stopped");
      }
      throw error;
    }
  }

  private waitReady(child: ChildProcess, ready: Readiness<T>, generation: number): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const timeoutMs = this.options.readyTimeoutMs ?? 60_000;
      let settled = false;
      let poll: ReturnType<typeof setTimeout> | undefined;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(poll);
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new ReadyTimeoutError(timeoutMs))), timeoutMs);
      let stderr = "";
      child.stderr!.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
      child.on("error", (error) => finish(() => reject(error)));
      child.once("exit", (code) =>
        finish(() => reject(generation !== this.generation ? new ProcessStoppedError() : new ProcessExitedError(this.options.name ?? "Process", code, stderr.trim().split("\n").slice(-3).join(" ")))),
      );
      if ("stdout" in ready) {
        let buffer = "";
        child.stdout!.on("data", (d) => {
          if (settled) return; // keep draining, but stop buffering
          buffer += d;
          for (const line of buffer.split("\n").slice(0, -1)) {
            const value = settled ? undefined : ready.stdout(line);
            if (value !== undefined) finish(() => resolve(value));
          }
          buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
        });
      } else {
        child.stdout!.resume(); // keep the pipe drained
        const { url, intervalMs = 250 } = ready.http;
        const probe = async () => {
          if (settled) return;
          const ok = await fetch(url, { signal: AbortSignal.timeout(2000) }).then(
            (res) => {
              void res.body?.cancel();
              return res.ok;
            },
            () => false,
          );
          if (ok) finish(() => resolve(undefined));
          else if (!settled) poll = setTimeout(probe, intervalMs);
        };
        void probe();
      }
    });
  }
}

/** Asks the OS for an unused loopback TCP port. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}
