import assert from "node:assert/strict";
import { test } from "node:test";
import { ManagedProcess, ProcessExitedError, ProcessStoppedError, ReadyTimeoutError, freePort, type ProcessSpec } from "./supervisor.ts";

const node = (script: string) => ({ command: process.execPath, args: ["-e", script] });
const SLEEP = "setInterval(() => {}, 1000)";
const readyLine = (line: string) => (line === "ready" ? "ok" : undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("becomes ready from a stdout line and exposes the ready value", async () => {
  const states: string[] = [];
  const p = new ManagedProcess<string>({ onStateChange: (s) => states.push(s), launch: () => ({ ...node(`console.log("noise"); console.log("ready"); ${SLEEP}`), ready: { stdout: readyLine } }) });
  try {
    assert.equal(await p.ensureRunning(), "ok");
    assert.equal(p.running, true);
    assert.equal(await p.ensureRunning(), "ok"); // already running: no second start
    assert.deepEqual(states, ["starting", "running"]);
  } finally {
    p.stop();
  }
  assert.equal(p.state, "stopped");
});

test("rejects with ReadyTimeoutError and kills the child when never ready", async () => {
  const p = new ManagedProcess({ readyTimeoutMs: 200, launch: () => ({ ...node(SLEEP), ready: { stdout: () => undefined } }) });
  await assert.rejects(p.ensureRunning(), ReadyTimeoutError);
  assert.equal(p.state, "stopped");
  assert.equal(p.pid, undefined);
});

test("rejects with ProcessExitedError carrying the stderr tail when the child exits before ready", async () => {
  const p = new ManagedProcess({ name: "Thing", launch: () => ({ ...node(`console.error("boom"); process.exit(3)`), ready: { stdout: () => undefined } }) });
  await assert.rejects(p.ensureRunning(), (error: Error) => error instanceof ProcessExitedError && error.code === 3 && error.message === "Thing exited (3). boom");
  assert.equal(p.state, "stopped");
});

test("rejects when the command cannot be spawned", async () => {
  const p = new ManagedProcess({ launch: () => ({ command: "/nonexistent/pista-test-binary", args: [], ready: { stdout: () => undefined } }) });
  await assert.rejects(p.ensureRunning(), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
  assert.equal(p.state, "stopped");
});

test("stop() during startup cancels it, and a following ensureRunning() starts fresh", async () => {
  let launches = 0;
  const p = new ManagedProcess<string>({
    readyTimeoutMs: 5000,
    launch: () => {
      launches++;
      // The first launch never becomes ready; the second does.
      const spec: ProcessSpec<string> = launches === 1 ? { ...node(SLEEP), ready: { stdout: () => undefined } } : { ...node(`console.log("ready"); ${SLEEP}`), ready: { stdout: readyLine } };
      return spec;
    },
  });
  try {
    const first = p.ensureRunning();
    const firstOutcome = first.then(() => "resolved", (e: unknown) => (e instanceof ProcessStoppedError ? "stopped" : "other"));
    await sleep(100);
    p.stop();
    assert.equal(await p.ensureRunning(), "ok");
    assert.equal(await firstOutcome, "stopped");
    assert.equal(launches, 2);
    assert.equal(p.running, true);
  } finally {
    p.stop();
  }
});

test("idle timer stops the process; pauseIdle holds it", async () => {
  let idled = 0;
  const p = new ManagedProcess<string>({ idleMs: 150, onIdle: () => (idled++, p.stop()), launch: () => ({ ...node(`console.log("ready"); ${SLEEP}`), ready: { stdout: readyLine } }) });
  try {
    await p.ensureRunning();
    p.armIdle();
    p.pauseIdle();
    await sleep(300);
    assert.equal(p.running, true);
    p.armIdle();
    await sleep(400);
    assert.equal(idled, 1);
    assert.equal(p.state, "stopped");
  } finally {
    p.stop();
  }
});

test("calls onExit when a ready process dies on its own", async () => {
  const exits: (number | null)[] = [];
  const p = new ManagedProcess<string>({ onExit: (info) => exits.push(info.code), launch: () => ({ ...node(`console.log("ready"); setTimeout(() => process.exit(5), 100)`), ready: { stdout: readyLine } }) });
  await p.ensureRunning();
  await sleep(400);
  assert.deepEqual(exits, [5]);
  assert.equal(p.state, "stopped");
});

test("becomes ready when an HTTP health probe answers", async () => {
  const port = await freePort();
  const script = `setTimeout(() => require("node:http").createServer((_q, r) => r.end("ok")).listen(${port}, "127.0.0.1"), 300); ${SLEEP}`;
  const p = new ManagedProcess({ readyTimeoutMs: 5000, launch: () => ({ ...node(script), ready: { http: { url: `http://127.0.0.1:${port}/`, intervalMs: 50 } } }) });
  try {
    await p.ensureRunning();
    assert.equal(p.running, true);
  } finally {
    p.stop();
  }
});
