import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const guards = fileURLToPath(new URL("./crash-guards.ts", import.meta.url));
const run = (listening: boolean, body: string) =>
  spawnSync(process.execPath, ["--import", "tsx", "-e", `import { installCrashGuards } from ${JSON.stringify(guards)}; installCrashGuards(() => ${listening}); ${body}`], { encoding: "utf8", timeout: 15000 });

test("a rejected promise is logged and the process keeps running", () => {
  const result = run(true, `Promise.reject(new Error("boom")); setTimeout(() => console.log("alive"), 50);`);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /alive/);
  assert.match(result.stderr, /unhandled rejection: Error: boom/);
});

test("an uncaught exception after startup is logged and survived", () => {
  const result = run(true, `setTimeout(() => { throw new Error("late"); }, 10); setTimeout(() => console.log("alive"), 50);`);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /alive/);
  assert.match(result.stderr, /uncaught exception: Error: late/);
});

test("an uncaught exception before the server is listening exits non-zero", () => {
  const result = run(false, `setTimeout(() => { throw new Error("EADDRINUSE"); }, 10); setTimeout(() => console.log("alive"), 200);`);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /alive/);
});
