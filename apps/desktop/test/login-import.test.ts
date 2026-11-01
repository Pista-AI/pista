import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { importLogins, parseLoginCsv } from "../src/login-import.ts";
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
  assert.ok(!JSON.stringify(result).includes("example.com"));
});
