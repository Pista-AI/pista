import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setupCredentials } from "./auth-setup.ts";
import { createEncryptedCredentialStore } from "./auth-store.ts";

const key = Buffer.alloc(32, 7);
const keyHex = key.toString("hex");
const dir = () => mkdtempSync(join(tmpdir(), "pista-auth-setup-"));
const lines = () => {
  const out: string[] = [];
  return { out, log: (l: string) => void out.push(l) };
};

test("migrates plain auth.json, existing encrypted entries win, plain file removed", async () => {
  const d = dir();
  createEncryptedCredentialStore({ file: join(d, "auth.enc.json"), key }).modify("openai", async () => ({ type: "api_key", key: "enc-openai" }));
  await new Promise((r) => setTimeout(r, 10));
  writeFileSync(join(d, "auth.json"), JSON.stringify({ openai: { type: "api_key", key: "plain-openai" }, anthropic: { type: "api_key", key: "plain-anthropic" } }));
  const { out, log } = lines();
  const res = await setupCredentials({ kind: "key", key }, d, log);
  assert.equal(res.mode, "encrypted");
  assert.ok(!existsSync(join(d, "auth.json")));
  const snap = await createEncryptedCredentialStore({ file: join(d, "auth.enc.json"), key }).exportSnapshot();
  assert.deepEqual(snap, { openai: { type: "api_key", key: "enc-openai" }, anthropic: { type: "api_key", key: "plain-anthropic" } });
  assert.match(out.join("\n"), /migrated 1 provider credential\(s\) from auth\.json into auth\.enc\.json/);
  assert.ok(!out.join("\n").includes("plain-anthropic") && !out.join("\n").includes("enc-openai"));
});

test("empty plain auth.json is just removed", async () => {
  const d = dir();
  writeFileSync(join(d, "auth.json"), "{}");
  const { out, log } = lines();
  const res = await setupCredentials({ kind: "key", key }, d, log);
  assert.ok(res.credentials);
  assert.ok(!existsSync(join(d, "auth.json")));
  assert.deepEqual(out, []);
});

test("corrupt plain auth.json is kept with a warning", async () => {
  const d = dir();
  writeFileSync(join(d, "auth.json"), "{not json");
  const { out, log } = lines();
  const res = await setupCredentials({ kind: "key", key }, d, log);
  assert.equal(res.mode, "encrypted");
  assert.equal(readFileSync(join(d, "auth.json"), "utf-8"), "{not json");
  assert.equal(out.length, 1);
});

test("plain mode refuses when auth.enc.json exists", async () => {
  const d = dir();
  writeFileSync(join(d, "auth.enc.json"), "{}");
  await assert.rejects(setupCredentials({ kind: "plain" }, d, () => {}), /auth\.enc\.json exists; refusing to start in plain mode/);
});

test("plain mode warns once and returns no store", async () => {
  const { out, log } = lines();
  const res = await setupCredentials({ kind: "plain" }, dir(), log);
  assert.deepEqual(res, { mode: "plain" });
  assert.deepEqual(out, ["[pista-host] auth: PISTA_AUTH_PLAIN=1, provider credentials stay in plain auth.json"]);
});

test("key hex never appears in logs or errors", async () => {
  const d = dir();
  writeFileSync(join(d, "auth.json"), JSON.stringify({ x: { type: "api_key", key: "k" } }));
  const { out, log } = lines();
  await setupCredentials({ kind: "key", key }, d, log);
  assert.ok(!out.join("\n").includes(keyHex));
  writeFileSync(join(d, "auth.enc.json"), "garbage");
  const store = (await setupCredentials({ kind: "key", key }, d, log)).credentials!;
  await assert.rejects(store.list(), (e: Error) => !e.message.includes(keyHex));
  assert.ok(!out.join("\n").includes(keyHex));
});

test("unsupported plain entries: not migrated, file kept", async () => {
  const d = dir();
  writeFileSync(join(d, "auth.json"), JSON.stringify({ x: { type: "weird" } }));
  const { out, log } = lines();
  const res = await setupCredentials({ kind: "key", key }, d, log);
  assert.ok(res.credentials);
  assert.ok(existsSync(join(d, "auth.json")));
  assert.deepEqual(out, ["[pista-host] auth: auth.json has unsupported entries; not migrated (file kept)"]);
});

test("rm failure after migration logs a warning and continues", async () => {
  const d = dir();
  // Same id already encrypted, so the import writes nothing and only the rm hits the read-only dir.
  await createEncryptedCredentialStore({ file: join(d, "auth.enc.json"), key }).modify("x", async () => ({ type: "api_key", key: "e" }));
  writeFileSync(join(d, "auth.json"), JSON.stringify({ x: { type: "api_key", key: "k" } }));
  chmodSync(d, 0o500);
  try {
    const { out, log } = lines();
    const res = await setupCredentials({ kind: "key", key }, d, log);
    assert.ok(res.credentials);
    if (process.getuid?.() !== 0) assert.ok(out.some((l) => /could not remove auth\.json after migration: EACCES/.test(l)), out.join("\n"));
  } finally {
    chmodSync(d, 0o700);
  }
});
