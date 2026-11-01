import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLoginVault, NO_KEYCHAIN_MESSAGE, type VaultCrypto } from "../src/logins.ts";

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
  assert.equal(got.loginUrl, input.loginUrl);
});

test("list never exposes the password or the login URL", async () => {
  const { vault } = await setup();
  await vault.save(input);
  const text = JSON.stringify(await vault.list());
  assert.ok(!text.includes(input.password));
  assert.ok(!text.includes("next="));
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
