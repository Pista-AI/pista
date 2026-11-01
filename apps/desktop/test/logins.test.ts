import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLoginVault, NO_KEYCHAIN_MESSAGE, safeStorageCrypto, type VaultCrypto } from "../src/logins.ts";

const MARK = "FAKE:";

function fakeCrypto(over: { available?: boolean; backend?: string } = {}): VaultCrypto {
  return {
    isAvailable: async () => over.available ?? true,
    backend: () => over.backend ?? "gnome_libsecret",
    encrypt: async (t: string) => Buffer.from(MARK + Buffer.from(t).toString("hex")),
    decrypt: async (b: Buffer) => Buffer.from(b.toString().slice(MARK.length), "hex").toString(),
  };
}

async function setup(over?: { available?: boolean; backend?: string }) {
  const dir = await mkdtemp(join(tmpdir(), "pista-vault-"));
  const file = join(dir, "sub", "logins.json");
  return { file, vault: createLoginVault({ file, crypto: fakeCrypto(over) }) };
}

const input = { label: "Shop", loginUrl: "https://shop.example.com/login?next=/a", username: "ann", password: "hunter2-secret" };

test("save, list and get round trip", async () => {
  const { vault } = await setup();
  const saved = await vault.save(input);
  assert.deepEqual(await vault.list(), [saved]);
  const got = await vault.get(saved.id);
  assert.equal(got.password, input.password);
  assert.equal(got.username, "ann");
  assert.equal(got.loginUrl, "https://shop.example.com/login");
});

test("list never exposes the password or the login URL", async () => {
  const { vault } = await setup();
  await vault.save(input);
  const text = JSON.stringify(await vault.list());
  assert.ok(!text.includes(input.password));
  assert.ok(!text.includes("login"));
});

test("the file on disk never contains the plaintext password", async () => {
  const { vault, file } = await setup();
  await vault.save(input);
  const disk = await readFile(file, "utf8");
  assert.ok(!disk.includes(input.password));
  assert.ok(disk.includes("blob"));
});

test("refuses to save without a keychain", async () => {
  for (const over of [{ backend: "basic_text" }, { available: false }]) {
    const { vault } = await setup(over);
    await assert.rejects(vault.save(input), { message: NO_KEYCHAIN_MESSAGE });
    assert.equal((await vault.status()).available, false);
  }
});

test("saving for the same origin replaces the login", async () => {
  const { vault } = await setup();
  await vault.save(input);
  const second = await vault.save({ ...input, loginUrl: "https://shop.example.com/other", username: "bob" });
  const all = await vault.list();
  assert.equal(all.length, 1);
  assert.equal(all[0]?.id, second.id);
  assert.equal(all[0]?.username, "bob");
});

test("remove deletes a login", async () => {
  const { vault } = await setup();
  const saved = await vault.save(input);
  await vault.remove(saved.id);
  assert.deepEqual(await vault.list(), []);
  await assert.rejects(vault.get(saved.id));
});

test("origin is normalized and http is only allowed on localhost", async () => {
  const { vault } = await setup();
  const saved = await vault.save({ ...input, loginUrl: "https://Shop.Example.com:8443/a/b?c=d" });
  assert.equal(saved.origin, "https://shop.example.com:8443");
  const local = await vault.save({ ...input, loginUrl: "http://localhost:3000/login" });
  assert.equal(local.origin, "http://localhost:3000");
  await vault.save({ ...input, loginUrl: "http://127.0.0.1:9/x" });
  await assert.rejects(vault.save({ ...input, loginUrl: "http://shop.example.com/login" }));
  await assert.rejects(vault.save({ ...input, loginUrl: "javascript:alert(1)" }));
  await assert.rejects(vault.save({ ...input, loginUrl: "not a url" }));
});

test("a corrupt file is reported and left unchanged", async () => {
  const { vault, file } = await setup();
  await vault.save(input);
  await writeFile(file, "{not json");
  await assert.rejects(vault.list(), /corrupt/);
  await assert.rejects(vault.save(input), /corrupt/);
  assert.equal(await readFile(file, "utf8"), "{not json");
});

test("the file is private to the user", { skip: process.platform === "win32" }, async () => {
  const { vault, file } = await setup();
  await vault.save(input);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test("login URL hygiene: no userinfo, no query or hash, trailing dot and default port collapse", async () => {
  const { vault } = await setup();
  await assert.rejects(vault.save({ ...input, loginUrl: "https://u:p@shop.example.com/" }));
  const a = await vault.save({ ...input, loginUrl: "https://shop.example.com.:443/x?q=1#h" });
  assert.equal(a.origin, "https://shop.example.com");
  assert.equal((await vault.get(a.id)).loginUrl, "https://shop.example.com/x");
  const v6 = await vault.save({ ...input, loginUrl: "http://[::1]:8080/" });
  assert.equal(v6.origin, "http://[::1]:8080");
});

test("file validation: version mismatch, non-array logins and bad entries are corrupt", async () => {
  const { vault, file } = await setup();
  await vault.save(input);
  for (const bad of [{ version: 2, logins: [] }, { version: 1, logins: {} }, { version: 1, logins: [{ id: 1 }] }, { version: 1, logins: [null] }]) {
    await writeFile(file, JSON.stringify(bad));
    await assert.rejects(vault.list(), /corrupt/);
  }
});

test("a blob moved to another entry or origin is rejected", async () => {
  const { vault, file } = await setup();
  const a = await vault.save(input);
  await vault.save({ ...input, loginUrl: "https://other.example.com/", username: "zed" });
  const data = JSON.parse(await readFile(file, "utf8"));
  data.logins[1].blob = data.logins[0].blob;
  await writeFile(file, JSON.stringify(data));
  await assert.rejects(vault.get(data.logins[1].id), { message: "Saved login is damaged." });
  data.logins[0].origin = "https://evil.example.com";
  await writeFile(file, JSON.stringify(data));
  await assert.rejects(vault.get(a.id), { message: "Saved login is damaged." });
});

test("save validates input and concurrent saves all land", async () => {
  const { vault } = await setup();
  await assert.rejects(vault.save({ ...input, label: "" }));
  await assert.rejects(vault.save({ ...input, label: "x".repeat(81) }));
  await assert.rejects(vault.save({ ...input, username: "x".repeat(201) }));
  await assert.rejects(vault.save({ ...input, password: "" }));
  await assert.rejects(vault.save({ ...input, password: "x".repeat(1001) }));
  await Promise.all([1, 2, 3, 4].map((n) => vault.save({ ...input, loginUrl: `https://s${n}.example.com/` })));
  assert.equal((await vault.list()).length, 4);
});

test("removing an unknown id does not rewrite the file", async () => {
  const { vault, file } = await setup();
  await vault.remove("nope");
  await assert.rejects(stat(file));
});

test("safeStorageCrypto reads .result and reports the backend", async () => {
  const c = safeStorageCrypto({
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => "basic_text",
    encryptStringAsync: async (t: string) => Buffer.from(t),
    decryptStringAsync: async (b: Buffer) => ({ result: b.toString() }),
  });
  assert.equal(c.backend(), "basic_text");
  assert.equal(await c.decrypt(await c.encrypt("x")), "x");
});
