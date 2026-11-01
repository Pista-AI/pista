import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { formatAuthKeyHex, resolveAuthKeySource } from "./auth-key.ts";

const HEX = "ab".repeat(32);

test("stdin: reads one hex line", async () => {
  const stdin = new PassThrough();
  stdin.write(`${HEX}\n`);
  const src = await resolveAuthKeySource({ PISTA_AUTH_KEY_STDIN: "1" }, stdin);
  assert.equal(src.kind, "key");
  assert.equal(src.kind === "key" && formatAuthKeyHex(src.key), HEX);
});

test("stdin: key split across chunks, CRLF accepted", async () => {
  const stdin = new PassThrough();
  const p = resolveAuthKeySource({ PISTA_AUTH_KEY_STDIN: "1" }, stdin);
  stdin.write(HEX.slice(0, 10));
  stdin.write(`${HEX.slice(10)}\r\n`);
  assert.equal((await p).kind, "key");
});

test("stdin: malformed, too long, ended and timeout all throw without echoing content", async () => {
  const bad = new PassThrough();
  bad.write("not-a-key-zzzz\n");
  await assert.rejects(resolveAuthKeySource({ PISTA_AUTH_KEY_STDIN: "1" }, bad), (e: Error) => /malformed/.test(e.message) && !e.message.includes("zzzz"));
  const long = new PassThrough();
  long.write("a".repeat(2000));
  await assert.rejects(resolveAuthKeySource({ PISTA_AUTH_KEY_STDIN: "1" }, long), /malformed/);
  const ended = new PassThrough();
  ended.end(HEX);
  await assert.rejects(resolveAuthKeySource({ PISTA_AUTH_KEY_STDIN: "1" }, ended), (e: Error) => /malformed/.test(e.message) && !e.message.includes(HEX));
  await assert.rejects(resolveAuthKeySource({ PISTA_AUTH_KEY_STDIN: "1" }, new PassThrough(), { timeoutMs: 20 }), /timed out/);
});

test("env: accepts a key and deletes the variable", async () => {
  const env: NodeJS.ProcessEnv = { PISTA_AUTH_KEY: HEX };
  const src = await resolveAuthKeySource(env, new PassThrough());
  assert.equal(src.kind, "key");
  assert.equal(env.PISTA_AUTH_KEY, undefined);
});

test("env: malformed key throws and does not echo it", async () => {
  const env: NodeJS.ProcessEnv = { PISTA_AUTH_KEY: "secret-nonhex" };
  await assert.rejects(resolveAuthKeySource(env, new PassThrough()), (e: Error) => /malformed/.test(e.message) && !e.message.includes("secret"));
  assert.equal(env.PISTA_AUTH_KEY, undefined);
});

test("stdin wins over env; plain; none", async () => {
  const stdin = new PassThrough();
  stdin.write(`${HEX}\n`);
  assert.equal((await resolveAuthKeySource({ PISTA_AUTH_KEY_STDIN: "1", PISTA_AUTH_PLAIN: "1" }, stdin)).kind, "key");
  assert.deepEqual(await resolveAuthKeySource({ PISTA_AUTH_PLAIN: "1" }, new PassThrough()), { kind: "plain" });
  await assert.rejects(resolveAuthKeySource({}, new PassThrough()), /No auth key: start Pista from the desktop app/);
});

test("stdin wins over PISTA_AUTH_KEY and the env var is removed", async () => {
  const other = "cd".repeat(32);
  const env: NodeJS.ProcessEnv = { PISTA_AUTH_KEY_STDIN: "1", PISTA_AUTH_KEY: other };
  const stdin = new PassThrough();
  stdin.write(`${HEX}\n`);
  const src = await resolveAuthKeySource(env, stdin);
  assert.equal(src.kind === "key" && formatAuthKeyHex(src.key), HEX);
  assert.equal(env.PISTA_AUTH_KEY, undefined);
});

test("stdin: no listeners remain after resolve or reject", async () => {
  const ok = new PassThrough();
  ok.write(`${HEX}\n`);
  await resolveAuthKeySource({ PISTA_AUTH_KEY_STDIN: "1" }, ok);
  const bad = new PassThrough();
  await assert.rejects(resolveAuthKeySource({ PISTA_AUTH_KEY_STDIN: "1" }, bad, { timeoutMs: 10 }));
  for (const s of [ok, bad]) for (const ev of ["data", "end", "error"]) assert.equal(s.listenerCount(ev), 0, ev);
});
