import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createImportStore, ImportError, importLogins, parseLoginCsv, previewLoginImport } from "../src/login-import.ts";
import { createLoginVault, type VaultCrypto } from "../src/logins.ts";

const crypto: VaultCrypto = {
  isAvailable: async () => true,
  backend: () => "gnome_libsecret",
  encrypt: async (t) => Buffer.from("FAKE:" + Buffer.from(t).toString("hex")),
  decrypt: async (b) => Buffer.from(b.toString().slice(5), "hex").toString(),
};
const count = (p: ReturnType<typeof parseLoginCsv>, reason: string) => p.skipped.find((s) => s.reason === reason)?.count ?? 0;

test("Chrome: BOM, CRLF, quoted commas, doubled quotes and embedded newline", () => {
  const csv = '﻿name,url,username,password,note\r\nShop,https://shop.example.com/login,ann,"pa,ss""w\nord",n\r\n,https://bare.example.org/,bob,pw,\r\n';
  const p = parseLoginCsv(csv);
  assert.equal(p.total, 2);
  assert.deepEqual(p.rows[0], { label: "Shop", loginUrl: "https://shop.example.com/login", username: "ann", password: 'pa,ss"w\nord' });
  assert.equal(p.rows[1].label, "bare.example.org");
});

test("Firefox headers", () => {
  const p = parseLoginCsv('"url","username","password","httpRealm","formActionOrigin","guid"\n"https://a.example.com","u","p","","https://a.example.com","{x}"\n');
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].label, "a.example.com");
});

test("Bitwarden: only logins, first of several URIs", () => {
  const csv = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,0,login,Bank,,,0,"https://bank.example.com/a,https://other.example.com",me,secret,\n,0,note,Memo,text,,0,,,,\n';
  const p = parseLoginCsv(csv);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].loginUrl, "https://bank.example.com/a");
  assert.equal(p.rows[0].label, "Bank");
  assert.equal(count(p, "not-login"), 1);
});

test("1Password and Apple headers, case-insensitive", () => {
  const op = parseLoginCsv("Title,Website,Username,Password,Notes\nMail,https://mail.example.com,me,pw,\n");
  assert.equal(op.rows[0].label, "Mail");
  const ap = parseLoginCsv("Title,URL,Username,Password,Notes,OTPAuth\nApp,https://app.example.com,me,pw,,\n");
  assert.equal(ap.rows[0].loginUrl, "https://app.example.com");
});

test("skips are counted by reason and carry no row content", () => {
  const csv = "name,url,username,password\nA,http://insecure.example.com,u,SECRETPW1\nB,http://localhost:3000/x,u,p\nC,https://c.example.com,u,\nD,,u,SECRETPW2\nE,not a url,u,SECRETPW3\n";
  const p = parseLoginCsv(csv);
  assert.equal(p.rows.length, 1);
  assert.equal(count(p, "not-https"), 1);
  assert.equal(count(p, "missing-field"), 1);
  assert.equal(count(p, "no-url"), 1);
  assert.equal(count(p, "bad-url"), 1);
  const text = JSON.stringify(p.skipped);
  for (const s of ["SECRETPW", "example.com", "localhost"]) assert.ok(!text.includes(s));
});

test("importLogins counts imported, replaced and failed; disk has no plaintext", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pista-import-"));
  const file = join(dir, "logins.json");
  const vault = createLoginVault({ file, crypto });
  await vault.save({ label: "Old", loginUrl: "https://a.example.com/login", username: "u", password: "old" });
  const rows = [
    { label: "A", loginUrl: "https://a.example.com/in", username: "u", password: "PLAINTEXT-ONE" },
    { label: "B", loginUrl: "https://b.example.com", username: "u", password: "PLAINTEXT-TWO" },
    { label: "C", loginUrl: "https://user:pw@c.example.com", username: "u", password: "PLAINTEXT-THREE" },
  ];
  const result = await importLogins(vault, rows);
  assert.deepEqual(result, { imported: 2, replaced: 1, failed: 1 });
  assert.equal((await vault.list()).length, 2);
  const disk = await readFile(file, "utf8");
  assert.ok(!disk.includes("PLAINTEXT"));
  // The result carries counts only: no row strings can reach the renderer.
  assert.ok(Object.values(result).every((v) => typeof v === "number"));
});

test("Bitwarden login_uri split on newlines too", () => {
  const p = parseLoginCsv('type,name,login_uri,login_username,login_password\nlogin,X,"https://x.example.com/a\nhttps://y.example.com",u,p\n');
  assert.equal(p.rows[0].loginUrl, "https://x.example.com/a");
});

test("missing url or password column, empty file and unterminated quote are rejected", () => {
  for (const bad of ["", "name,username\nA,b\n", "name,url,username\nA,https://a.example.com,b\n", 'name,url,username,password\nA,"https://a.example.com,b,c\n'])
    assert.throws(() => parseLoginCsv(bad), { message: "This doesn't look like a password export." });
});

test("last line without newline and ragged rows", () => {
  const p = parseLoginCsv("name,url,username,password\nA,https://a.example.com,u,p\nB,https://b.example.com\nC,https://c.example.com,u,p");
  assert.equal(p.rows.length, 2);
  assert.equal(count(p, "missing-field"), 1);
});

test("importLogins dedupes by origin (last wins) and a failing row does not stop later rows", async () => {
  const saved: string[] = [];
  const vault = {
    list: async () => [{ id: "1", label: "o", origin: "https://a.example.com", username: "u" }],
    save: async (r: { loginUrl: string; password: string }) => {
      if (r.password === "bad") throw new Error("nope /secret/path");
      saved.push(r.password);
    },
  };
  const row = (url: string, password: string) => ({ label: "x", loginUrl: url, username: "u", password });
  const r = await importLogins(vault, [row("https://a.example.com/1", "first"), row("https://z.example.com", "bad"), row("https://a.example.com/2", "second"), row("https://b.example.com", "ok")]);
  assert.deepEqual(r, { imported: 2, replaced: 1, failed: 1 });
  assert.deepEqual(saved, ["second", "ok"]);
});

function deps(over: Record<string, unknown> = {}) {
  const csv = "name,url,username,password\nA,https://a.example.com,u,SECRETPW\nB,https://b.example.com,v,SECRETPW2\nC,http://insecure.example.com,w,SECRETPW3\n";
  return {
    vault: { list: async () => [{ id: "1", label: "o", origin: "https://a.example.com", username: "u" }], save: async () => {} },
    pick: async () => "/Users/me/secret-dir/export.csv",
    size: async () => csv.length,
    read: async () => Buffer.from(csv),
    ...over,
  } as Parameters<typeof previewLoginImport>[0];
}

test("previewLoginImport errors carry fixed messages without paths", async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ size: async () => 5_000_001 }, "That file is too large to be a password export."],
    [{ size: async () => { throw new Error("ENOENT: no such file /Users/me/secret-dir/export.csv"); } }, "That file could not be read."],
    [{ pick: async () => { throw new Error("dialog /Users/me"); } }, "That file could not be read."],
    [{ read: async () => Buffer.from([0xff, 0xfe, 0x80]) }, "That file could not be read."],
    [{ read: async () => Buffer.alloc(0) }, "This doesn't look like a password export."],
  ];
  for (const [over, message] of cases) {
    const err = await previewLoginImport(deps(over), createImportStore()).then(() => null, (e: Error) => e);
    assert.ok(err instanceof ImportError);
    assert.equal(err.message, message);
    assert.ok(!err.message.includes("/Users"));
  }
  assert.deepEqual(await previewLoginImport(deps({ pick: async () => null }), createImportStore()), { canceled: true });
});

test("preview has no passwords, marks replaces, and lists skips with a line", async () => {
  const p = await previewLoginImport(deps(), createImportStore());
  assert.ok("token" in p);
  const text = JSON.stringify(p);
  assert.ok(!text.includes("SECRETPW") && !text.includes("password") && !text.includes("secret-dir"));
  assert.deepEqual(p.source, { kind: "csv", fileName: "export.csv" });
  assert.deepEqual(p.rows.map((r) => [r.origin, r.replaces]), [["https://a.example.com", true], ["https://b.example.com", false]]);
  assert.deepEqual(p.skipped, [{ line: 4, reason: "not-https" }]);
});

test("commit saves only the chosen subset and trashes only after a clean import", async () => {
  const saved: string[] = [];
  const trashed: string[] = [];
  const vault = { list: async () => [], save: async (r: { username: string }) => void saved.push(r.username) };
  const store = createImportStore();
  const p = await previewLoginImport(deps({ vault }), store);
  assert.ok("token" in p);
  const sub = await store.commit(vault, async (f) => void trashed.push(f), { token: p.token, ids: [p.rows[1].id], trashFile: true });
  assert.deepEqual(saved, ["v"]);
  assert.equal(sub.imported, 1);
  assert.equal(sub.trashed, false);
  const all = await previewLoginImport(deps({ vault }), store);
  assert.ok("token" in all);
  const r = await store.commit(vault, async (f) => void trashed.push(f), { token: all.token, ids: all.rows.map((x) => x.id), trashFile: true });
  assert.equal(r.trashed, true);
  assert.deepEqual(trashed, ["/Users/me/secret-dir/export.csv"]);

  const failing = { list: async () => [], save: async () => { throw new Error("x"); } };
  const q = await previewLoginImport(deps({ vault: failing }), store);
  assert.ok("token" in q);
  const r2 = await store.commit(failing, async (f) => void trashed.push(f), { token: q.token, ids: q.rows.map((x) => x.id), trashFile: true });
  assert.equal(r2.trashed, false);
  assert.equal(trashed.length, 1);

  const s = await previewLoginImport(deps({ vault }), store);
  assert.ok("token" in s);
  assert.equal((await store.commit(vault, async (f) => void trashed.push(f), { token: s.token, ids: s.rows.map((x) => x.id) })).trashed, false);
});

test("token is one-shot, expires, and cancel drops it", async () => {
  let now = 1000;
  const store = createImportStore({ now: () => now, ttlMs: 5 * 60_000 });
  const vault = { list: async () => [], save: async () => {} };
  const run = (token: string) => store.commit(vault, async () => {}, { token, ids: ["0"] });
  const rejects = (token: string) => assert.rejects(run(token), { message: "That import has expired. Choose the file again." });

  let p = await previewLoginImport(deps({ vault }), store);
  assert.ok("token" in p);
  assert.equal((await run(p.token)).imported, 1);
  await rejects(p.token);

  p = await previewLoginImport(deps({ vault }), store);
  assert.ok("token" in p);
  now += 5 * 60_000;
  await rejects(p.token);

  p = await previewLoginImport(deps({ vault }), store);
  assert.ok("token" in p);
  store.cancel(p.token);
  await rejects(p.token);

  // A failed commit still spends the token, and a new preview replaces the pending one.
  const bad = { list: async () => [], save: async () => { throw new Error("x"); } };
  p = await previewLoginImport(deps({ vault }), store);
  assert.ok("token" in p);
  assert.equal((await store.commit(bad, async () => {}, { token: p.token, ids: ["0"] })).failed, 1);
  await rejects(p.token);
  const first = await previewLoginImport(deps({ vault }), store);
  await previewLoginImport(deps({ vault }), store);
  assert.ok("token" in first);
  await rejects(first.token);
});

test("forged tokens, foreign ids, partial selection and duplicates", async () => {
  const saved: string[] = [];
  const trashed: string[] = [];
  const vault = { list: async () => [], save: async (r: { username: string }) => void saved.push(r.username) };
  const store = createImportStore();
  for (const t of ["nope", "", undefined as unknown as string, "../x"])
    await assert.rejects(store.commit(vault, async () => {}, { token: t, ids: ["0"] }), { message: "That import has expired. Choose the file again." });

  const dup = "name,url,username,password\nA,https://a.example.com/1,u1,p\nB,https://a.example.com/2,u2,p\nC,https://c.example.com,u3,p\n";
  const p = await previewLoginImport(deps({ vault, read: async () => Buffer.from(dup), size: async () => dup.length }), store);
  assert.ok("token" in p);
  assert.deepEqual(p.skipped, [{ reason: "duplicate" }]);
  assert.equal(p.rows.length, 2);
  const r = await store.commit(vault, async (f) => void trashed.push(f), { token: p.token, ids: ["0", "99", "x"], trashFile: true });
  assert.deepEqual(saved, ["u2"]);
  assert.equal(r.trashed, false);
  assert.equal(trashed.length, 0);
  assert.equal(r.skipped, 2);
});

test("vault failure during preview gives a fixed message", async () => {
  const bad = { list: async () => { throw new Error("/secret/path"); }, save: async () => {} };
  await assert.rejects(previewLoginImport(deps({ vault: bad }), createImportStore()), { message: "Saved logins could not be read." });
});

test("pending rows are dropped by the timer without any call", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const store = createImportStore({ ttlMs: 1000 });
  const vault = { list: async () => [], save: async () => {} };
  const p = await previewLoginImport(deps({ vault }), store);
  assert.ok("token" in p);
  t.mock.timers.tick(1001);
  await assert.rejects(store.commit(vault, async () => {}, { token: p.token, ids: ["0"] }), { message: "That import has expired. Choose the file again." });
});
