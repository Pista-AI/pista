import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readEncryptedFile } from "./auth-store.ts";
import { createEncryptedAuthStorageBackend, setupMcpAuth } from "./mcp-auth-store.ts";
import type { McpOAuthCredentialStoreCtor } from "./pi-mcp-oauth.ts";

const key = Buffer.alloc(32, 9);
const dir = () => mkdtempSync(join(tmpdir(), "pista-mcp-auth-"));
const fakeLoad = async (): Promise<McpOAuthCredentialStoreCtor> =>
  class {
    constructor(readonly b: unknown, readonly d: string) {}
    forServer() { return {}; }
    tokens() { return undefined; }
    remove() { return false; }
  } as never;
const lines = () => {
  const out: string[] = [];
  return { out, log: (l: string) => void out.push(l) };
};

test("round-trips through withLock and withLockAsync", async () => {
  const d = dir();
  const b = createEncryptedAuthStorageBackend({ file: join(d, "x.enc.json"), key });
  assert.equal(b.withLock((c) => ({ result: c })), undefined);
  b.withLock(() => ({ result: 1, next: '{"a":1}' }));
  assert.equal(await b.withLockAsync(async (c) => ({ result: c })), '{"a":1}');
  assert.ok(!readFileSync(join(d, "x.enc.json"), "utf-8").includes('"a"'));
  assert.equal(b.withLock((c) => ({ result: c })), '{"a":1}');
});

test("concurrent withLockAsync calls serialise", async () => {
  const d = dir();
  const b = createEncryptedAuthStorageBackend({ file: join(d, "x.enc.json"), key });
  await Promise.all(
    Array.from({ length: 8 }, () =>
      b.withLockAsync(async (c) => {
        const n = c === undefined ? 0 : Number(c);
        await new Promise((r) => setTimeout(r, 5));
        return { result: undefined, next: String(n + 1) };
      }),
    ),
  );
  assert.equal(await b.withLockAsync(async (c) => ({ result: c })), "8");
  assert.ok(!existsSync(join(d, "x.enc.json.lock")));
});

test("wrong key errors, does not overwrite, and never prints the key", () => {
  const d = dir();
  const file = join(d, "x.enc.json");
  createEncryptedAuthStorageBackend({ file, key }).withLock(() => ({ result: 0, next: "{}" }));
  const before = readFileSync(file, "utf-8");
  const wrong = Buffer.alloc(32, 1);
  const b = createEncryptedAuthStorageBackend({ file, key: wrong });
  assert.throws(() => b.withLock(() => ({ result: 0, next: "{}" })), (e: Error) => /cannot decrypt/.test(e.message) && !e.message.includes(wrong.toString("hex")) && !e.message.includes(wrong.toString("base64")));
  assert.equal(readFileSync(file, "utf-8"), before);
});

test("refuses a symlinked file", () => {
  const d = dir();
  writeFileSync(join(d, "real"), "{}");
  symlinkSync(join(d, "real"), join(d, "x.enc.json"));
  assert.throws(() => readEncryptedFile(join(d, "x.enc.json"), key), /not a regular file/);
});

test("migrates plain mcp-auth.json; content round-trips; plain file removed", async () => {
  const d = dir();
  const plain = { "fake-server": { tokens: { access_token: "tok-fake-test" } } };
  writeFileSync(join(d, "mcp-auth.json"), JSON.stringify(plain));
  const { out, log } = lines();
  const res = await setupMcpAuth({ kind: "key", key: Buffer.from(key) }, d, log, fakeLoad);
  assert.ok(res.credentials);
  assert.ok(!existsSync(join(d, "mcp-auth.json")));
  assert.ok(!readFileSync(join(d, "mcp-auth.enc.json"), "utf-8").includes("tok-fake-test"));
  assert.deepEqual(JSON.parse(readEncryptedFile(join(d, "mcp-auth.enc.json"), key)!), plain);
  assert.match(out.join("\n"), /migrated 1 MCP server/);
  assert.ok(!out.join("\n").includes("tok-fake-test"));
});

test("unparseable plain file is kept at 0600 with one warning", async () => {
  const d = dir();
  writeFileSync(join(d, "mcp-auth.json"), "{nope");
  chmodSync(join(d, "mcp-auth.json"), 0o644);
  const { out, log } = lines();
  const res = await setupMcpAuth({ kind: "key", key: Buffer.from(key) }, d, log, fakeLoad);
  assert.ok(res.credentials);
  assert.equal(readFileSync(join(d, "mcp-auth.json"), "utf-8"), "{nope");
  if (process.platform !== "win32") assert.equal(statSync(join(d, "mcp-auth.json")).mode & 0o777, 0o600);
  assert.equal(out.filter((l) => l.includes("WARNING")).length, 1);
});

test("plain mode refuses when the encrypted file exists, and otherwise returns no store", async () => {
  const d = dir();
  assert.deepEqual(await setupMcpAuth({ kind: "plain" }, d, () => {}, fakeLoad), {});
  createEncryptedAuthStorageBackend({ file: join(d, "mcp-auth.enc.json"), key }).withLock(() => ({ result: 0, next: "{}" }));
  await assert.rejects(setupMcpAuth({ kind: "plain" }, d, () => {}, fakeLoad), /refusing to start in plain mode/);
});

test("encrypted mode fails closed when the loader throws, and on a wrong key without echoing it", async () => {
  const d = dir();
  await assert.rejects(setupMcpAuth({ kind: "key", key: Buffer.from(key) }, d, () => {}, async () => { throw new Error("no class"); }), /no class/);
  createEncryptedAuthStorageBackend({ file: join(d, "mcp-auth.enc.json"), key }).withLock(() => ({ result: 0, next: "{}" }));
  const wrong = Buffer.alloc(32, 2);
  await assert.rejects(setupMcpAuth({ kind: "key", key: wrong }, d, () => {}, fakeLoad), (e: Error) => /cannot be decrypted/.test(e.message) && !e.message.includes(Buffer.alloc(32, 2).toString("hex")));
});
