import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAuthKeyVault, hostChildEnv, NO_AUTH_KEYCHAIN_MESSAGE, sendKeyToHost } from "../src/auth-key.ts";
import type { VaultCrypto } from "../src/logins.ts";

const MARK = "FAKE:";

function fakeCrypto(available = true): VaultCrypto {
  return {
    isAvailable: async () => available,
    backend: () => "fake",
    encrypt: async (t: string) => Buffer.from(MARK + t),
    decrypt: async (b: Buffer) => b.toString().slice(MARK.length),
  };
}

async function setup(available = true) {
  const dir = await mkdtemp(join(tmpdir(), "pista-authkey-"));
  const file = join(dir, "sub", "auth-key.json");
  return { file, vault: createAuthKeyVault({ file, crypto: fakeCrypto(available) }) };
}

test("first load creates a 0600 file and returns 32 bytes", async () => {
  const { file, vault } = await setup();
  const key = await vault.load();
  assert.equal(key.length, 32);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.ok(!(await readFile(file, "utf8")).includes(key.toString("hex").slice(0, 16)), "key is wrapped, not in the clear");
});

test("second load returns the same key", async () => {
  const { vault } = await setup();
  const a = await vault.load();
  const b = await vault.load();
  assert.ok(a.equals(b));
});

test("a corrupt file throws and is left unchanged", async () => {
  for (const content of ["not json", JSON.stringify({ version: 2, blob: "x" }), JSON.stringify({ version: 1, blob: Buffer.from(MARK + "zz").toString("base64") })]) {
    const { file, vault } = await setup();
    await vault.load();
    await writeFile(file, content);
    await assert.rejects(vault.load(), /corrupt/);
    assert.equal(await readFile(file, "utf8"), content);
  }
});

test("an unavailable keychain throws and writes nothing", async () => {
  const { file, vault } = await setup(false);
  await assert.rejects(vault.load(), new Error(NO_AUTH_KEYCHAIN_MESSAGE));
  await assert.rejects(stat(file));
});

test("load errors never contain key material", async () => {
  const { file, vault } = await setup();
  const key = (await vault.load()).toString("hex");
  const messages: string[] = [];
  await writeFile(file, JSON.stringify({ version: 1, blob: Buffer.from(MARK + key + "00").toString("base64") }));
  await vault.load().catch((e: Error) => messages.push(e.message));
  await writeFile(file, `{"version":1,"blob":"${key}`);
  await vault.load().catch((e: Error) => messages.push(e.message));
  assert.equal(messages.length, 2);
  for (const m of messages) assert.ok(!m.includes(key) && !/[0-9a-f]{32}/.test(m));
});

test("sendKeyToHost posts a 32-byte Uint8Array copy, then zeroes the caller's buffer", () => {
  const posted: unknown[] = [];
  const key = Buffer.alloc(32, 0xab);
  sendKeyToHost({ postMessage: (m) => posted.push(structuredClone(m)) }, key);
  assert.equal(posted.length, 1);
  const msg = posted[0] as { type: string; key: Uint8Array };
  assert.equal(msg.type, "auth-key");
  assert.deepEqual([...msg.key], new Array(32).fill(0xab));
  assert.ok(key.every((b) => b === 0));
});

test("sendKeyToHost zeroes the buffer even when postMessage throws", () => {
  const key = Buffer.alloc(32, 1);
  assert.throws(() => sendKeyToHost({ postMessage: () => { throw new Error("gone"); } }, key));
  assert.ok(key.every((b) => b === 0));
});

test("a throwing decrypt gives a clear error and leaves the file unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pista-authkey-"));
  const file = join(dir, "auth-key.json");
  await createAuthKeyVault({ file, crypto: fakeCrypto() }).load();
  const before = await readFile(file, "utf8");
  const bad = { ...fakeCrypto(), decrypt: async () => { throw new Error("keychain says SECRETDETAIL"); } };
  await assert.rejects(createAuthKeyVault({ file, crypto: bad }).load(), (e: Error) => /could not be decrypted/.test(e.message) && !e.message.includes("SECRETDETAIL"));
  assert.equal(await readFile(file, "utf8"), before);
});

test("an encrypt failure leaves no tmp file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pista-authkey-"));
  const file = join(dir, "auth-key.json");
  const bad = { ...fakeCrypto(), encrypt: async () => { throw new Error("nope"); } };
  await assert.rejects(createAuthKeyVault({ file, crypto: bad }).load());
  assert.deepEqual(await readdir(dir), []);
  // A write failure after encrypt (target is a directory) also cleans up its tmp file.
  const dir2 = await mkdtemp(join(tmpdir(), "pista-authkey-"));
  await mkdir(join(dir2, "auth-key.json"));
  await assert.rejects(createAuthKeyVault({ file: join(dir2, "auth-key.json"), crypto: fakeCrypto() }).load());
  assert.deepEqual((await readdir(dir2)).filter((f) => f.endsWith(".tmp")), []);
});

test("decrypted content of the wrong length or uppercase hex is corrupt", async () => {
  for (const hex of ["ab".repeat(31), "ab".repeat(33), "AB".repeat(32)]) {
    const dir = await mkdtemp(join(tmpdir(), "pista-authkey-"));
    const file = join(dir, "auth-key.json");
    const content = JSON.stringify({ version: 1, blob: Buffer.from(MARK + hex).toString("base64") });
    await writeFile(file, content);
    await assert.rejects(createAuthKeyVault({ file, crypto: fakeCrypto() }).load(), /corrupt/);
    assert.equal(await readFile(file, "utf8"), content);
  }
});

test("hostChildEnv drops auth variables from the user's shell and keeps ours", () => {
  const env = hostChildEnv({ PISTA_AUTH_KEY: "ab".repeat(32), PISTA_AUTH_KEY_PORT: "0", PISTA_AUTH_PLAIN: "1", FOO: "bar" }, { PISTA_AUTH_KEY_PORT: "1" });
  assert.deepEqual(env, { FOO: "bar", PISTA_AUTH_KEY_PORT: "1" });
});

test("concurrent first loads agree on one key and the file holds it", async () => {
  const { file, vault } = await setup();
  const keys = await Promise.all(Array.from({ length: 8 }, () => vault.load()));
  for (const k of keys) assert.ok(k.equals(keys[0]!));
  assert.ok((await vault.load()).equals(keys[0]!));
  assert.equal(JSON.parse(await readFile(file, "utf8")).blob, Buffer.from(MARK + keys[0]!.toString("hex")).toString("base64"));
  assert.deepEqual((await readdir(join(file, ".."))).filter((n) => n.endsWith(".tmp")), []);
});

test("an existing key file is never overwritten", async () => {
  const { file, vault } = await setup();
  const first = await vault.load();
  const before = await readFile(file, "utf8");
  const other = createAuthKeyVault({ file, crypto: fakeCrypto() });
  assert.ok((await other.load()).equals(first));
  assert.equal(await readFile(file, "utf8"), before);
});
