import assert from "node:assert/strict";
import { test } from "node:test";
import { loadManagedPolicy, type PolicyIo } from "./policy.ts";
import { MAC_PLIST, readMacManaged, readMdmPolicy, readWindowsPolicyKey, type CommandRunner, type FileInfo, type LstatFn } from "./policy-mdm.ts";

const POLICY = JSON.stringify({ version: 1, locked: { approvalMode: "read-only" } });
const good: FileInfo = { isFile: true, isSymlink: false, uid: 0, mode: 0o100644 };
const lstatOf = (info: FileInfo | null): LstatFn => () => info;
const plutil = (dict: unknown): CommandRunner => () => ({ status: 0, stdout: JSON.stringify(dict), stderr: "" });
const regOut = (name: string, type: string, value: string) => `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Pista\r\n    ${name}    ${type}    ${value}\r\n\r\n`;
const absent = { status: 1, stdout: "", stderr: "ERROR: The system was unable to find the specified registry key or value.\r\n" };

test("macOS: PolicyJSON and PolicyJSONBase64 are read, missing file is none", () => {
  const calls: string[][] = [];
  const run: CommandRunner = (file, args) => (calls.push([file, ...args]), plutil({ PolicyJSON: POLICY })(file, args));
  const ok = readMacManaged(run, lstatOf(good));
  assert.deepEqual(ok, { kind: "ok", text: POLICY, source: `macOS managed preferences (${MAC_PLIST})` });
  assert.deepEqual(calls[0], ["/usr/bin/plutil", "-convert", "json", "-o", "-", MAC_PLIST]);
  const b64 = readMacManaged(plutil({ PolicyJSONBase64: Buffer.from(POLICY).toString("base64") }), lstatOf(good));
  assert.equal(b64.kind === "ok" && b64.text, POLICY);
  assert.deepEqual(readMacManaged(plutil({}), lstatOf(null)), { kind: "none" });
});

test("macOS: both keys, bad base64, or a plist with neither", () => {
  assert.equal(readMacManaged(plutil({ PolicyJSON: POLICY, PolicyJSONBase64: "e30=" }), lstatOf(good)).kind, "error");
  assert.equal(readMacManaged(plutil({ PolicyJSONBase64: "!!!" }), lstatOf(good)).kind, "error");
  const none = readMacManaged(plutil({ Other: 1 }), lstatOf(good));
  assert.equal(none.kind, "none");
  assert.match(none.kind === "none" ? none.warnings![0]! : "", /neither/);
});

test("macOS: non-root, group/world-writable, symlink and non-file are rejected without running plutil", () => {
  const never: CommandRunner = () => assert.fail("plutil must not run");
  for (const info of [{ ...good, uid: 501 }, { ...good, mode: 0o100664 }, { ...good, mode: 0o100646 }, { ...good, isSymlink: true }, { ...good, isFile: false }]) {
    const r = readMacManaged(never, lstatOf(info));
    assert.equal(r.kind, "error");
    assert.match(r.kind === "error" ? r.message : "", /not root-owned/);
  }
});

test("Windows: values parsed from a multi-value listing, base64 variant, HKCU never queried", () => {
  const calls: string[][] = [];
  const listing = `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Pista\r\n    Other    REG_DWORD    0x1\r\n    PolicyJSON    REG_SZ    ${POLICY}\r\n`;
  const r = readWindowsPolicyKey((file, args) => (calls.push([file, ...args]), { status: 0, stdout: listing, stderr: "" }), { SystemRoot: "D:\\Win" });
  assert.equal(r.kind === "ok" && r.text, POLICY);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["D:\\Win\\System32\\reg.exe", "query", "HKLM\\SOFTWARE\\Policies\\Pista"]);
  assert.ok(!calls.flat().join(" ").includes("HKCU"));
  const b64 = readWindowsPolicyKey(() => ({ status: 0, stdout: `\r\nKEY\r\n    PolicyJSONBase64    REG_EXPAND_SZ    ${Buffer.from(POLICY).toString("base64")}\r\n`, stderr: "" }), {});
  assert.equal(b64.kind === "ok" && b64.text, POLICY);
  const neither = readWindowsPolicyKey(() => ({ status: 0, stdout: "\r\nKEY\r\n    Other    REG_SZ    x\r\n", stderr: "" }), {});
  assert.equal(neither.kind, "none");
  assert.equal(readWindowsPolicyKey(() => ({ status: 0, stdout: "\r\nKEY\r\n    PolicyJSON    REG_DWORD    0x1\r\n", stderr: "" }), {}).kind, "error");
});

test("Windows: key absent is none, key present but unreadable is an error, whatever the message language", () => {
  const fail = { status: 1, stdout: "", stderr: "FEHLER: Zugriff verweigert" };
  const probeCalls: string[][] = [];
  const absent: CommandRunner = (_f, args) => (probeCalls.push(args), args.includes("/k") ? { status: 1, stdout: "", stderr: "" } : fail);
  assert.deepEqual(readWindowsPolicyKey(absent, {}), { kind: "none" });
  assert.deepEqual(probeCalls[1], ["query", "HKLM\\SOFTWARE\\Policies", "/k", "/f", "Pista", "/e"]);
  const present: CommandRunner = (_f, args) => (args.includes("/k") ? { status: 0, stdout: "\r\n hkey_local_machine\\software\\policies\\pista \r\nEnd of search: 1 match(es) found.\r\n", stderr: "" } : fail);
  assert.equal(readWindowsPolicyKey(present, {}).kind, "error");
});

test("Windows: reg.exe that cannot run fails closed, on the query or the probe", () => {
  const dead = { status: null, stdout: "", stderr: "spawn ENOENT" };
  assert.equal(readWindowsPolicyKey(() => dead, {}).kind, "error");
  const probeDead: CommandRunner = (_f, args) => (args.includes("/k") ? dead : { status: 1, stdout: "", stderr: "" });
  assert.equal(readWindowsPolicyKey(probeDead, {}).kind, "error");
});

test("macOS: plutil that cannot run or fails on an existing root-owned file is an error", () => {
  assert.equal(readMacManaged(() => ({ status: null, stdout: "", stderr: "timeout" }), lstatOf(good)).kind, "error");
  assert.equal(readMacManaged(() => ({ status: 1, stdout: "", stderr: "bad" }), lstatOf(good)).kind, "error");
});

test("Windows: value names are matched case-insensitively", () => {
  const r = readWindowsPolicyKey(() => ({ status: 0, stdout: `\r\nKEY\r\n    policyjson    REG_SZ    ${POLICY}\r\n`, stderr: "" }), {});
  assert.equal(r.kind === "ok" && r.text, POLICY);
});

test("linux has no MDM source", () => {
  assert.deepEqual(readMdmPolicy("linux", {}, () => assert.fail("no command"), () => assert.fail("no lstat")), { kind: "none" });
});

// Precedence through loadManagedPolicy.
const envFile = "/p/env.json";
const osFile = "/Library/Application Support/Pista/managed-policy.json";
const body = (mode: string) => JSON.stringify({ version: 1, locked: { approvalMode: mode } });
const io = (files: Record<string, string>): PolicyIo => ({ exists: (p) => p in files, read: (p) => files[p]! });
const mdmOk = { run: plutil({ PolicyJSON: body("ask-writes") }), lstat: lstatOf(good) };

test("precedence: env file beats MDM, MDM beats the platform file", () => {
  const files = io({ [envFile]: body("full-access"), [osFile]: body("read-only") });
  const env = loadManagedPolicy({ PISTA_POLICY_FILE: envFile }, "darwin", files, mdmOk);
  assert.equal(env.sourceKind, "env-file");
  assert.equal(env.policy?.locked?.approvalMode, "full-access");
  const mdm = loadManagedPolicy({}, "darwin", files, mdmOk);
  assert.equal(mdm.sourceKind, "mdm");
  assert.equal(mdm.policy?.locked?.approvalMode, "ask-writes");
  assert.match(mdm.source!, /managed preferences/);
  const file = loadManagedPolicy({}, "darwin", files, { run: plutil({}), lstat: lstatOf(null) });
  assert.equal(file.sourceKind, "file");
  assert.equal(file.policy?.locked?.approvalMode, "read-only");
});

test("an MDM error is a failure and does not fall through to the file; bad MDM JSON too", () => {
  const files = io({ [osFile]: body("read-only") });
  const bad = loadManagedPolicy({}, "darwin", files, { run: plutil({}), lstat: lstatOf({ ...good, uid: 501 }) });
  assert.equal(bad.policy, null);
  assert.equal(bad.sourceKind, "mdm");
  assert.match(bad.failure!, /not root-owned/);
  const junk = loadManagedPolicy({}, "darwin", files, { run: plutil({ PolicyJSON: "{nope" }), lstat: lstatOf(good) });
  assert.equal(junk.policy, null);
  assert.ok(junk.failure);
});

test("linux ignores MDM; PISTA_REQUIRE_POLICY still fails with no source", () => {
  const files = io({ "/etc/pista/managed-policy.json": body("read-only") });
  const r = loadManagedPolicy({}, "linux", files, { run: () => assert.fail("no command"), lstat: () => assert.fail("no lstat") });
  assert.equal(r.sourceKind, "file");
  const req = loadManagedPolicy({ PISTA_REQUIRE_POLICY: "1" }, "darwin", io({}), { run: plutil({}), lstat: lstatOf(null) });
  assert.match(req.failure!, /PISTA_REQUIRE_POLICY/);
});
