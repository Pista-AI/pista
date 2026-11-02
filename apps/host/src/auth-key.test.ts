import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { currentParentPort, formatAuthKeyHex, resolveAuthKeySource } from "./auth-key.ts";

const HEX = "ab".repeat(32);

function fakePort() {
  const port = new EventEmitter();
  return Object.assign(port, { send: (data: unknown) => port.emit("message", { data }) });
}
const keyBytes = () => new Uint8Array(Buffer.from(HEX, "hex"));

test("port: reads the key message and zeroes the received bytes", async () => {
  const port = fakePort();
  const bytes = keyBytes();
  const p = resolveAuthKeySource({ PISTA_AUTH_KEY_PORT: "1" }, port);
  port.send({ type: "auth-key", key: bytes });
  const src = await p;
  assert.equal(src.kind === "key" && formatAuthKeyHex(src.key), HEX);
  assert.ok(bytes.every((b) => b === 0));
  assert.equal(port.listenerCount("message"), 0);
});

test("port: malformed messages throw without echoing content", async () => {
  for (const data of [{ type: "auth-key", key: new Uint8Array(31).fill(7) }, { type: "auth-key", key: HEX }, { type: "auth-key" }, { type: "auth-key", key: "zzzz" }]) {
    const port = fakePort();
    const p = resolveAuthKeySource({ PISTA_AUTH_KEY_PORT: "1" }, port);
    port.send(data);
    await assert.rejects(p, (e: Error) => /malformed/.test(e.message) && !e.message.includes(HEX) && !e.message.includes("zzzz"));
  }
});

test("port: unrelated messages are ignored until the key arrives; env var consumed", async () => {
  const port = fakePort();
  const env: NodeJS.ProcessEnv = { PISTA_AUTH_KEY_PORT: "1" };
  const p = resolveAuthKeySource(env, port);
  port.send({ type: "other", key: keyBytes() });
  port.send(null);
  port.send("noise");
  port.send({ type: "auth-key", key: keyBytes() });
  const src = await p;
  assert.equal(src.kind === "key" && formatAuthKeyHex(src.key), HEX);
  assert.equal(env.PISTA_AUTH_KEY_PORT, undefined);
  assert.equal(port.listenerCount("message"), 0);
});

test("port: timeout, and missing parent port, give clear errors", async () => {
  const port = fakePort();
  await assert.rejects(resolveAuthKeySource({ PISTA_AUTH_KEY_PORT: "1" }, port, { timeoutMs: 20 }), /timed out/);
  assert.equal(port.listenerCount("message"), 0);
  await assert.rejects(resolveAuthKeySource({ PISTA_AUTH_KEY_PORT: "1" }, undefined), /desktop app/);
});

test("currentParentPort is undefined in plain Node", () => {
  assert.equal(currentParentPort(), undefined);
});

test("env: accepts a key and deletes the variable", async () => {
  const env: NodeJS.ProcessEnv = { PISTA_AUTH_KEY: HEX };
  const src = await resolveAuthKeySource(env, undefined);
  assert.equal(src.kind, "key");
  assert.equal(env.PISTA_AUTH_KEY, undefined);
});

test("env: malformed key throws and does not echo it", async () => {
  const env: NodeJS.ProcessEnv = { PISTA_AUTH_KEY: "secret-nonhex" };
  await assert.rejects(resolveAuthKeySource(env, undefined), (e: Error) => /malformed/.test(e.message) && !e.message.includes("secret"));
  assert.equal(env.PISTA_AUTH_KEY, undefined);
});

test("port wins over env and removes the env var; plain; none", async () => {
  const other = "cd".repeat(32);
  const env: NodeJS.ProcessEnv = { PISTA_AUTH_KEY_PORT: "1", PISTA_AUTH_KEY: other };
  const port = fakePort();
  const p = resolveAuthKeySource(env, port);
  port.send({ type: "auth-key", key: keyBytes() });
  const src = await p;
  assert.equal(src.kind === "key" && formatAuthKeyHex(src.key), HEX);
  assert.equal(env.PISTA_AUTH_KEY, undefined);
  assert.deepEqual(await resolveAuthKeySource({ PISTA_AUTH_PLAIN: "1" }, undefined), { kind: "plain" });
  await assert.rejects(resolveAuthKeySource({}, undefined), /No auth key: start Pista from the desktop app/);
});
