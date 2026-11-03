import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createEncryptedAuthStorageBackend } from "./mcp-auth-store.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setupCredentials } from "./auth-setup.ts";
import { BACKUP_KEEP_MS, createEncryptedCredentialStore, dropBackupIfEncryptedOk } from "./auth-store.ts";

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
  const res = await setupCredentials({ kind: "key", key: Buffer.from(key) }, d, log);
  assert.equal(res.mode, "encrypted");
  assert.ok(!existsSync(join(d, "auth.json")));
  assert.ok(existsSync(join(d, "auth.json.migrated.bak")));
  const snap = await createEncryptedCredentialStore({ file: join(d, "auth.enc.json"), key }).exportSnapshot();
  assert.deepEqual(snap, { openai: { type: "api_key", key: "enc-openai" }, anthropic: { type: "api_key", key: "plain-anthropic" } });
  assert.match(out.join("\n"), /migrated 1 provider credential\(s\) from auth\.json into auth\.enc\.json/);
  assert.ok(!out.join("\n").includes("plain-anthropic") && !out.join("\n").includes("enc-openai"));
});

test("empty plain auth.json is just removed", async () => {
  const d = dir();
  writeFileSync(join(d, "auth.json"), "{}");
  const { out, log } = lines();
  const res = await setupCredentials({ kind: "key", key: Buffer.from(key) }, d, log);
  assert.ok(res.credentials);
  assert.ok(!existsSync(join(d, "auth.json")));
  assert.equal(out.length, 1);
  assert.match(out[0], /kept the migrated plaintext as .*auth\.json\.migrated\.bak/);
});

test("corrupt plain auth.json is kept with a warning", async () => {
  const d = dir();
  writeFileSync(join(d, "auth.json"), "{not json");
  const { out, log } = lines();
  const res = await setupCredentials({ kind: "key", key: Buffer.from(key) }, d, log);
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
  await setupCredentials({ kind: "key", key: Buffer.from(key) }, d, log);
  assert.ok(!out.join("\n").includes(keyHex));
  writeFileSync(join(d, "auth.enc.json"), "garbage");
  await assert.rejects(setupCredentials({ kind: "key", key: Buffer.from(key) }, d, log), (e: Error) => !e.message.includes(keyHex));
  assert.ok(!out.join("\n").includes(keyHex));
});

test("unsupported plain entries: not migrated, file kept", async () => {
  const d = dir();
  writeFileSync(join(d, "auth.json"), JSON.stringify({ x: { type: "weird" } }));
  const { out, log } = lines();
  const res = await setupCredentials({ kind: "key", key: Buffer.from(key) }, d, log);
  assert.ok(res.credentials);
  assert.ok(existsSync(join(d, "auth.json")));
  assert.equal(out.length, 1);
  assert.match(out[0], /WARNING plaintext credentials remain at .*auth\.json/);
  if (process.platform !== "win32") assert.equal(statSync(join(d, "auth.json")).mode & 0o777, 0o600);
});

test("rename failure after migration keeps auth.json with a warning and continues", async () => {
  const d = dir();
  await createEncryptedCredentialStore({ file: join(d, "auth.enc.json"), key }).modify("x", async () => ({ type: "api_key", key: "e" }));
  writeFileSync(join(d, "auth.json"), JSON.stringify({ x: { type: "api_key", key: "k" } }));
  chmodSync(d, 0o500);
  try {
    const { out, log } = lines();
    const res = await setupCredentials({ kind: "key", key: Buffer.from(key) }, d, log);
    assert.ok(res.credentials);
    if (process.getuid?.() !== 0) assert.ok(out.some((l) => /WARNING plaintext credentials remain.*could not move it to a backup: EACCES/.test(l)), out.join("\n"));
  } finally {
    chmodSync(d, 0o700);
  }
});

test("wrong key fails at startup, says different key, never says delete, and leaves every file alone", async () => {
  const d = dir();
  await createEncryptedCredentialStore({ file: join(d, "auth.enc.json"), key }).modify("x", async () => ({ type: "api_key", key: "k" }));
  writeFileSync(join(d, "auth.json.migrated.bak"), "{}");
  const before = readFileSync(join(d, "auth.enc.json"), "utf-8");
  const other = Buffer.alloc(32, 9);
  await assert.rejects(setupCredentials({ kind: "key", key: other }, d, () => {}), (e: Error) => {
    assert.match(e.message, /^auth\.enc\.json was encrypted with a different key than the one the app supplied\. The file has been left untouched at .*auth\.enc\.json\. The plaintext backup from the earlier migration is still at .*auth\.json\.migrated\.bak; you can recover from it\.$/);
    assert.ok(!/delete/i.test(e.message) && !e.message.includes(other.toString("hex")));
    return true;
  });
  assert.equal(readFileSync(join(d, "auth.enc.json"), "utf-8"), before);
  assert.ok(existsSync(join(d, "auth.json.migrated.bak")));
});

test("both stores failing are reported in one message", async () => {
  const d = dir();
  await createEncryptedCredentialStore({ file: join(d, "auth.enc.json"), key }).modify("x", async () => ({ type: "api_key", key: "k" }));
  createEncryptedAuthStorageBackend({ file: join(d, "mcp-auth.enc.json"), key }).withLock(() => ({ result: 0, next: "{}" }));
  writeFileSync(join(d, "mcp-auth.json.migrated.bak"), "{}");
  const a = readFileSync(join(d, "auth.enc.json"), "utf-8");
  const m = readFileSync(join(d, "mcp-auth.enc.json"), "utf-8");
  await assert.rejects(setupCredentials({ kind: "key", key: Buffer.alloc(32, 9) }, d, () => {}), (e: Error) => {
    const [first, second, ...rest] = e.message.split("\n");
    assert.equal(rest.length, 0);
    assert.match(first, /^mcp-auth\.enc\.json was encrypted with a different key.*mcp-auth\.json\.migrated\.bak/);
    assert.match(second, /^auth\.enc\.json was encrypted with a different key.*left untouched/);
    return true;
  });
  assert.equal(readFileSync(join(d, "auth.enc.json"), "utf-8"), a);
  assert.equal(readFileSync(join(d, "mcp-auth.enc.json"), "utf-8"), m);
});

test("a corrupt file is reported as corrupt, not as a different key", async () => {
  const d = dir();
  writeFileSync(join(d, "auth.enc.json"), "garbage");
  await assert.rejects(setupCredentials({ kind: "key", key: Buffer.from(key) }, d, () => {}), /^Error: auth\.enc\.json is corrupt\. The file has been left untouched/);
  assert.equal(readFileSync(join(d, "auth.enc.json"), "utf-8"), "garbage");
});

test("an encrypted file without a key id still loads", async () => {
  const d = dir();
  const f = join(d, "auth.enc.json");
  await createEncryptedCredentialStore({ file: f, key }).modify("x", async () => ({ type: "api_key", key: "k" }));
  const env = JSON.parse(readFileSync(f, "utf-8"));
  delete env.kid;
  writeFileSync(f, JSON.stringify(env));
  const res = await setupCredentials({ kind: "key", key: Buffer.from(key) }, d, () => {});
  assert.equal((await res.credentials!.list()).length, 1);
});

test("the .bak survives its own run and a good start within 24 hours, which logs where it is", async () => {
  const d = dir();
  writeFileSync(join(d, "auth.json"), JSON.stringify({ x: { type: "api_key", key: "k" } }));
  await setupCredentials({ kind: "key", key: Buffer.from(key) }, d, () => {});
  const bak = join(d, "auth.json.migrated.bak");
  assert.ok(existsSync(bak) && !existsSync(join(d, "auth.json")));
  if (process.platform !== "win32") assert.equal(statSync(bak).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(bak, "utf-8")).x.key, "k");
  const { out, log } = lines();
  await setupCredentials({ kind: "key", key: Buffer.from(key) }, d, log);
  assert.ok(existsSync(bak));
  assert.ok(out.some((l) => /plaintext backup of migrated credentials exists at .*auth\.json\.migrated\.bak; it is removed on a start after/.test(l)), out.join("\n"));
});

test("a .bak older than 24 hours is removed after a good decrypt, a younger one is not", async () => {
  const d = dir();
  const enc = join(d, "auth.enc.json");
  const plain = join(d, "auth.json");
  const bak = `${plain}.migrated.bak`;
  await createEncryptedCredentialStore({ file: enc, key }).modify("x", async () => ({ type: "api_key", key: "k" }));
  writeFileSync(bak, "{}");
  const now = Date.now();
  dropBackupIfEncryptedOk(enc, plain, () => {}, now + BACKUP_KEEP_MS - 60_000);
  assert.ok(existsSync(bak));
  dropBackupIfEncryptedOk(enc, plain, () => {}, now + BACKUP_KEEP_MS + 60_000);
  assert.ok(!existsSync(bak));
});

test("plain mode warns where a .bak is", async () => {
  const d = dir();
  writeFileSync(join(d, "auth.json.migrated.bak"), "{}");
  const { out, log } = lines();
  await setupCredentials({ kind: "plain" }, d, log);
  assert.ok(out.some((l) => /WARNING a plaintext backup .*auth\.json\.migrated\.bak/.test(l)));
});

test("a wrong key never removes the .bak", async () => {
  const d = dir();
  writeFileSync(join(d, "auth.json"), JSON.stringify({ x: { type: "api_key", key: "k" } }));
  await setupCredentials({ kind: "key", key: Buffer.from(key) }, d, () => {});
  await assert.rejects(setupCredentials({ kind: "key", key: Buffer.alloc(32, 9) }, d, () => {}), /different key/);
  assert.ok(existsSync(join(d, "auth.json.migrated.bak")));
});

test("partial import: valid entries migrate, the plain file stays 0600 with one warning", async () => {
  const d = dir();
  writeFileSync(join(d, "auth.json"), JSON.stringify({ good: { type: "api_key", key: "plain-good" }, bad: { type: "weird" } }), { mode: 0o644 });
  const { out, log } = lines();
  await setupCredentials({ kind: "key", key: Buffer.from(key) }, d, log);
  assert.ok(existsSync(join(d, "auth.json")));
  if (process.platform !== "win32") assert.equal(statSync(join(d, "auth.json")).mode & 0o777, 0o600);
  const snap = await createEncryptedCredentialStore({ file: join(d, "auth.enc.json"), key }).exportSnapshot();
  assert.deepEqual(Object.keys(snap), ["good"]);
  assert.equal(out.filter((l) => /WARNING plaintext/.test(l)).length, 1);
  assert.ok(!out.join("\n").includes("plain-good"));
});

test("unparseable plain file is kept at 0600 with a warning", async () => {
  const d = dir();
  writeFileSync(join(d, "auth.json"), "{not json", { mode: 0o644 });
  const { out, log } = lines();
  await setupCredentials({ kind: "key", key: Buffer.from(key) }, d, log);
  assert.ok(existsSync(join(d, "auth.json")));
  if (process.platform !== "win32") assert.equal(statSync(join(d, "auth.json")).mode & 0o777, 0o600);
  assert.match(out.join("\n"), /WARNING plaintext credentials remain/);
});

test("setupCredentials zeroes the caller's key buffer", async () => {
  const k = Buffer.from(key);
  await setupCredentials({ kind: "key", key: k }, dir(), () => {});
  assert.ok(k.every((b) => b === 0));
});
