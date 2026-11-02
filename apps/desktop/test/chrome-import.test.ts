import assert from "node:assert/strict";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listChromeProfiles, previewChromeImport, readChromeLogins } from "../src/chrome-import.ts";
import { createImportStore } from "../src/login-import.ts";

const darwin = { skip: process.platform !== "darwin" && "macOS only" };
const PASS = "fixture-passphrase";
const enc = (plain: string) => {
  const key = pbkdf2Sync(PASS, "saltysalt", 1003, 16, "sha1");
  const c = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from("v10"), c.update(plain, "utf8"), c.final()]);
};
const getKey = async () => PASS;
const tmpEntries = async () => (await readdir(tmpdir())).filter((n) => n.startsWith("pista-chrome-"));

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "chrome-fixture-"));
  await mkdir(join(dir, "Default"));
  await mkdir(join(dir, "Empty"));
  await writeFile(join(dir, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Personal" }, Empty: { name: "Nothing" }, Gone: { name: "Gone" } } } }));
  const db = new DatabaseSync(join(dir, "Default", "Login Data"));
  db.exec("CREATE TABLE logins (origin_url TEXT, username_value TEXT, password_value BLOB, blacklisted_by_user INTEGER)");
  const ins = db.prepare("INSERT INTO logins VALUES (?, ?, ?, ?)");
  ins.run("https://shop.example.com/login", "ann", enc("s3cret"), 0);
  ins.run("https://old.example.com/", "bob", Buffer.concat([Buffer.from("v11"), Buffer.alloc(20)]), 0);
  ins.run("https://never.example.com/", "cy", enc("x"), 1);
  ins.run("android://abc@com.example.app/", "dee", enc("y"), 0);
  ins.run("https://bad.example.com/", "eve", Buffer.concat([Buffer.from("v10"), Buffer.alloc(16, 1)]), 0);
  db.close();
  return dir;
}

test("lists profiles that have Login Data", darwin, async () => {
  const dir = await fixture();
  assert.deepEqual(await listChromeProfiles(dir), [{ dir: "Default", name: "Personal" }]);
  await rm(dir, { recursive: true });
});

test("decrypts, skips unknown prefix, blacklisted, android and bad padding; temp copy removed", darwin, async () => {
  const dir = await fixture();
  const r = await readChromeLogins({ chromeDir: dir, profileDir: "Default", getKey });
  assert.deepEqual(r.rows, [{ label: "shop.example.com", loginUrl: "https://shop.example.com/login", username: "ann", password: "s3cret" }]);
  assert.deepEqual(r.skipped.map((s) => s.reason).sort(), ["not-https", "undecryptable", "unknown-format"]);
  assert.deepEqual(await tmpEntries(), []);
  await rm(dir, { recursive: true });
});

test("temp copy removed when reading throws; message has no path", darwin, async () => {
  const dir = await fixture();
  await assert.rejects(
    readChromeLogins({ chromeDir: dir, profileDir: "Default", getKey: async () => Promise.reject(new Error("denied")) }),
    (e: Error) => !e.message.includes(dir) && !e.message.includes("denied"),
  );
  assert.deepEqual(await tmpEntries(), []);
  await rm(dir, { recursive: true });
});

test("preview rejects profiles that are not listed (path traversal)", darwin, async () => {
  const dir = await fixture();
  const store = createImportStore();
  const vault = { list: async () => [] };
  for (const bad of ["../Default", "Gone", "Empty", "/etc"]) await assert.rejects(previewChromeImport({ vault, chromeDir: dir, getKey }, store, bad));
  const p = await previewChromeImport({ vault, chromeDir: dir, getKey }, store, "Default");
  assert.deepEqual(p.source, { kind: "chrome", profile: "Personal" });
  assert.equal(p.rows.length, 1);
  assert.ok(!JSON.stringify(p).includes("s3cret"));
  await rm(dir, { recursive: true });
});

test("copies the journal and WAL next to the temp copy with 0600, then removes them", darwin, async () => {
  const dir = await fixture();
  await writeFile(join(dir, "Default", "Login Data-journal"), "");
  await writeFile(join(dir, "Default", "Login Data-wal"), "");
  const seen: { name: string; mode: number }[] = [];
  await readChromeLogins({
    chromeDir: dir,
    profileDir: "Default",
    getKey: async () => {
      for (const t of await tmpEntries()) for (const f of await readdir(join(tmpdir(), t))) seen.push({ name: f, mode: (await stat(join(tmpdir(), t, f))).mode & 0o777 });
      return PASS;
    },
  }).catch(() => {});
  assert.deepEqual(seen.map((s) => s.name).sort(), ["Login Data", "Login Data-journal", "Login Data-wal"]);
  assert.ok(seen.every((s) => s.mode === 0o600));
  assert.deepEqual(await tmpEntries(), []);
  await rm(dir, { recursive: true });
});
