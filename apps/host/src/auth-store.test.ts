import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createCipheriv } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createEncryptedCredentialStore } from "./auth-store.ts";

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), "pista-auth-"));
  const file = join(dir, "sub", "auth.enc.json");
  const key = randomBytes(32);
  return { file, key, store: createEncryptedCredentialStore({ file, key }) };
};
const oauth = { type: "oauth", access: "a", refresh: "r", expires: 123 } as const;

test("rejects a key that is not 32 bytes", () => {
  assert.throws(() => createEncryptedCredentialStore({ file: "x", key: randomBytes(16) }), /32 bytes/);
});

test("empty store: no file, nothing listed", async () => {
  const { store, file } = setup();
  assert.deepEqual(await store.list(), []);
  assert.equal(await store.read("openai"), undefined);
  assert.throws(() => statSync(file));
});

test("round trips api_key and oauth, ciphertext hides secrets", async () => {
  const { store, file } = setup();
  await store.modify("openai", async () => ({ type: "api_key", key: "sk-secret" }));
  await store.modify("codex", async () => oauth);
  assert.deepEqual(await store.read("openai"), { type: "api_key", key: "sk-secret" });
  assert.deepEqual(await store.read("codex"), oauth);
  assert.deepEqual(await store.list(), [
    { providerId: "openai", type: "api_key" },
    { providerId: "codex", type: "oauth" },
  ]);
  const raw = readFileSync(file, "utf-8");
  assert.ok(!raw.includes("sk-secret"));
  assert.equal(JSON.parse(raw).alg, "aes-256-gcm");
});

test("modify sees current, preserves others; undefined leaves unchanged", async () => {
  const { store } = setup();
  await store.modify("a", async () => ({ type: "api_key", key: "1" }));
  await store.modify("b", async (cur) => {
    assert.equal(cur, undefined);
    return { type: "api_key", key: "2" };
  });
  const same = await store.modify("a", async (cur) => {
    assert.equal((cur as { key: string }).key, "1");
    return undefined;
  });
  assert.deepEqual(same, { type: "api_key", key: "1" });
  assert.deepEqual(Object.keys(await store.exportSnapshot()).sort(), ["a", "b"]);
});

test("delete removes one provider only", async () => {
  const { store } = setup();
  await store.modify("a", async () => ({ type: "api_key", key: "1" }));
  await store.modify("b", async () => ({ type: "api_key", key: "2" }));
  await store.delete("a");
  await store.delete("missing");
  assert.deepEqual((await store.list()).map((c) => c.providerId), ["b"]);
});

test("read resolves key variables; list and snapshot stay raw and never run commands", async () => {
  const { store } = setup();
  await store.modify("p", async () => ({ type: "api_key", key: "$KEY_VAR", env: { KEY_VAR: "resolved" } }));
  await store.modify("q", async () => ({ type: "api_key", key: "!touch /nonexistent/should-never-run" }));
  assert.equal(((await store.read("p")) as { key: string }).key, "resolved");
  assert.equal((await store.list()).length, 2);
  assert.equal((await store.exportSnapshot()).p.type === "api_key" && (await store.exportSnapshot()).p.key, "$KEY_VAR");
});

test("wrong key errors instead of looking empty", async () => {
  const { store, file } = setup();
  await store.modify("a", async () => ({ type: "api_key", key: "1" }));
  const other = createEncryptedCredentialStore({ file, key: randomBytes(32) });
  await assert.rejects(other.list(), /auth store: cannot decrypt .*encrypted with a different key/);
  await assert.rejects(other.modify("b", async () => oauth), /cannot decrypt/);
  assert.deepEqual((await store.list()).length, 1);
});

test("a file without a key id (written before it existed) still loads; a wrong key on it reads as unknown", async () => {
  const { store, file } = setup();
  await store.modify("a", async () => ({ type: "api_key", key: "1" }));
  const env = JSON.parse(readFileSync(file, "utf-8"));
  assert.match(env.kid, /^[0-9a-f]{16}$/);
  delete env.kid;
  writeFileSync(file, JSON.stringify(env));
  assert.equal((await store.list()).length, 1);
  await assert.rejects(createEncryptedCredentialStore({ file, key: randomBytes(32) }).list(), /wrong key or corrupt file/);
});

test("corrupt file errors and is left untouched", async () => {
  const { store, file } = setup();
  await store.modify("a", async () => ({ type: "api_key", key: "1" }));
  writeFileSync(file, "{not json");
  await assert.rejects(store.read("a"), /cannot decrypt/);
  await assert.rejects(store.modify("b", async () => oauth), /cannot decrypt/);
  await assert.rejects(store.delete("a"), /cannot decrypt/);
  assert.equal(readFileSync(file, "utf-8"), "{not json");
});

test("file is 0600 and its directory 0700", async () => {
  const { store, file } = setup();
  await store.modify("a", async () => ({ type: "api_key", key: "1" }));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(join(file, "..")).mode & 0o777, 0o700);
});

test("parallel modifies serialize and all survive", async () => {
  const { store } = setup();
  await Promise.all(Array.from({ length: 10 }, (_, i) => store.modify(`p${i}`, async () => ({ type: "api_key", key: String(i) }))));
  assert.equal((await store.list()).length, 10);
});

test("importPlain adds new ids and skips existing ones", async () => {
  const { store } = setup();
  await store.modify("a", async () => ({ type: "api_key", key: "keep" }));
  const res = await store.importPlain({ a: { type: "api_key", key: "new" }, b: oauth });
  assert.deepEqual(res, { imported: ["b"], skipped: ["a"] });
  assert.deepEqual(await store.read("a"), { type: "api_key", key: "keep" });
  await assert.rejects(store.importPlain({ c: { type: "oauth" } as never }), /invalid credential/);
});

const tamper = (file: string, fn: (env: Record<string, unknown>) => void) => {
  const env = JSON.parse(readFileSync(file, "utf-8"));
  fn(env);
  writeFileSync(file, JSON.stringify(env));
  return readFileSync(file, "utf-8");
};
const flip = (b64: string) => {
  const b = Buffer.from(b64, "base64");
  b[0] ^= 1;
  return b.toString("base64");
};

test("flipped data/tag byte, truncated tag and unknown version throw and leave the file unchanged", async () => {
  const mutations: Array<(e: Record<string, unknown>) => void> = [
    (e) => (e.data = flip(e.data as string)),
    (e) => (e.tag = flip(e.tag as string)),
    (e) => (e.tag = Buffer.from(e.tag as string, "base64").subarray(0, 8).toString("base64")),
    (e) => (e.version = 2),
  ];
  for (const m of mutations) {
    const { store, file } = setup();
    await store.modify("a", async () => ({ type: "api_key", key: "1" }));
    const before = tamper(file, m);
    await assert.rejects(store.read("a"), /cannot decrypt/);
    await assert.rejects(store.modify("b", async () => oauth), /cannot decrypt/);
    assert.equal(readFileSync(file, "utf-8"), before);
  }
});

test("error messages never leak the key or stored secrets", async () => {
  const { store, file, key } = setup();
  await store.modify("a", async () => ({ type: "api_key", key: "sk-very-secret" }));
  const other = randomBytes(32);
  for (const k of [other, key]) {
    if (k === key) tamper(file, (e) => (e.data = flip(e.data as string)));
    const err = await createEncryptedCredentialStore({ file, key: k }).list().catch((e: Error) => e);
    assert.ok(err instanceof Error);
    for (const secret of [key.toString("hex"), other.toString("hex"), key.toString("base64"), "sk-very-secret"]) {
      assert.ok(!err.message.includes(secret));
    }
  }
});

test("two saves use different ivs", async () => {
  const { store, file } = setup();
  await store.modify("a", async () => ({ type: "api_key", key: "1" }));
  const iv1 = JSON.parse(readFileSync(file, "utf-8")).iv;
  await store.modify("b", async () => ({ type: "api_key", key: "2" }));
  assert.notEqual(JSON.parse(readFileSync(file, "utf-8")).iv, iv1);
});

test("a rejecting modify fn leaves the file unchanged and the store usable", async () => {
  const { store, file } = setup();
  await store.modify("a", async () => ({ type: "api_key", key: "1" }));
  const before = readFileSync(file, "utf-8");
  await assert.rejects(store.modify("b", async () => Promise.reject(new Error("boom"))), /boom/);
  assert.equal(readFileSync(file, "utf-8"), before);
  await store.modify("c", async () => oauth);
  assert.equal((await store.list()).length, 2);
});

test("read runs a !cmd key exactly once (cached); list never runs it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pista-auth-"));
  const file = join(dir, "auth.enc.json");
  let calls = 0;
  const store = createEncryptedCredentialStore({ file, key: randomBytes(32), exec: () => (++calls, "from-cmd") });
  await store.modify("p", async () => ({ type: "api_key", key: "!unique-test-cmd-xyz" }));
  await store.list();
  await store.exportSnapshot();
  assert.equal(calls, 0);
  assert.equal(((await store.read("p")) as { key: string }).key, "from-cmd");
  assert.equal(calls, 1);
});

test("a symlink or non-regular file at the store path is refused and never overwritten", async () => {
  const { file, key, store } = setup();
  mkdirSync(join(file, ".."), { recursive: true });
  const target = join(file, "..", "elsewhere.txt");
  writeFileSync(target, "untouched");
  symlinkSync(target, file);
  await assert.rejects(store.list(), /not a regular file/);
  await assert.rejects(store.modify("a", async () => ({ type: "api_key", key: "1" })), /not a regular file/);
  assert.equal(readFileSync(target, "utf-8"), "untouched");
  const dirCase = setup();
  mkdirSync(dirCase.file, { recursive: true });
  await assert.rejects(dirCase.store.list(), /not a regular file/);
  void key;
});

test("a stale tmp file does not break the write and leaves no tmp behind", async () => {
  const { file, store } = setup();
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(`${file}.stale.tmp`, "junk");
  await store.modify("a", async () => ({ type: "api_key", key: "1" }));
  assert.ok(existsSync(file));
  assert.deepEqual(readdirSync(join(file, "..")).filter((f) => f.endsWith(".tmp") && !f.includes("stale")), []);
});

test("a looser data directory is tightened to 0700", async () => {
  if (process.platform === "win32") return;
  const { file, store } = setup();
  mkdirSync(join(file, ".."), { recursive: true, mode: 0o755 });
  const { chmodSync } = await import("node:fs");
  chmodSync(join(file, ".."), 0o755);
  await store.modify("a", async () => ({ type: "api_key", key: "1" }));
  assert.equal(statSync(join(file, "..")).mode & 0o777, 0o700);
});

test("a file encrypted without the version/alg AAD does not decrypt, and non-canonical base64 is rejected", async () => {
  const { file, key, store } = setup();
  await store.modify("a", async () => ({ type: "api_key", key: "1" }));
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update('{"a":{"type":"api_key","key":"1"}}', "utf-8"), c.final()]);
  const env = { version: 1, alg: "aes-256-gcm", iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
  writeFileSync(file, JSON.stringify(env));
  await assert.rejects(store.list(), /cannot decrypt/);
  const good = setup();
  await good.store.modify("a", async () => ({ type: "api_key", key: "1" }));
  const e = JSON.parse(readFileSync(good.file, "utf-8"));
  e.data = `${e.data}\n`;
  writeFileSync(good.file, JSON.stringify(e));
  await assert.rejects(good.store.list(), /cannot decrypt/);
});
