import assert from "node:assert/strict";
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadManagedPolicy, type PolicyIo, type RemoteSource } from "./policy.ts";
import { fetchBundle, readCache, remoteSourceFromEnv, resolveRemotePolicy, signBundle, verifyBundle, writeCache } from "./policy-remote.ts";

const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { pub: publicKey.export({ type: "spki", format: "pem" }) as string, priv: privateKey.export({ type: "pkcs8", format: "pem" }) as string };
};
const k = pair();
const policy = (serial: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ version: 1, serial, locked: { approvalMode: "read-only" }, ...extra });
const bundle = (serial = 1, priv = k.priv) => signBundle(policy(serial), priv);
const reply = (body: string, status = 200): typeof fetch => async () => new Response(body, { status });
const source: RemoteSource = { url: "https://policy.example.com/p.json", publicKey: k.pub, refreshMinutes: 60 };
const dir = () => mkdtempSync(join(tmpdir(), "pista-remote-"));
const mutate = (text: string, edit: (e: Record<string, string>) => void) => {
  const e = JSON.parse(text);
  edit(e);
  return JSON.stringify(e);
};

test("valid signature is accepted and sign->verify round-trips", () => {
  const r = verifyBundle(bundle(3), k.pub);
  assert.ok(r.ok);
  assert.equal(r.serial, 3);
  assert.equal(r.policy.policy?.locked?.approvalMode, "read-only");
});

test("tampered payload, tampered signature and wrong key are rejected", () => {
  const b = bundle();
  const other = Buffer.from(policy(1, { locked: { approvalMode: "full" } })).toString("base64");
  assert.equal(verifyBundle(mutate(b, (e) => (e.payload = other)), k.pub).ok, false);
  const sig = Buffer.from(JSON.parse(b).signature, "base64");
  sig[0] ^= 1;
  assert.equal(verifyBundle(mutate(b, (e) => (e.signature = sig.toString("base64"))), k.pub).ok, false);
  assert.equal(verifyBundle(b, pair().pub).ok, false);
});

test("a non-ed25519 key is rejected", () => {
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }) as string;
  const r = verifyBundle(bundle(), rsa);
  assert.ok(!r.ok);
  assert.match(r.reason, /Ed25519/);
  assert.throws(() => signBundle(policy(1), generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }) as string), /Ed25519/);
});

test("payload needs a serial and must not chain policySource", () => {
  assert.equal(verifyBundle(rawSign(JSON.stringify({ version: 1 })), k.pub).ok, false);
  assert.equal(verifyBundle(rawSign(policy(-1)), k.pub).ok, false);
  assert.equal(verifyBundle(rawSign(policy(1, { policySource: { url: "https://x.example", publicKey: "k" } })), k.pub).ok, false);
  assert.throws(() => signBundle(JSON.stringify({ version: 1 }), k.priv), /serial/);
});

function rawSign(text: string): string {
  const payload = Buffer.from(text);
  return JSON.stringify({ format: "pista-signed-policy/1", payload: payload.toString("base64"), signature: sign(null, payload, createPrivateKey(k.priv)).toString("base64") });
}

test("non-canonical base64 and a bad format are rejected", () => {
  const b = bundle();
  assert.equal(verifyBundle(mutate(b, (e) => (e.payload = `${e.payload}\n`)), k.pub).ok, false);
  assert.equal(verifyBundle(mutate(b, (e) => (e.format = "other/1")), k.pub).ok, false);
  assert.equal(verifyBundle("not json", k.pub).ok, false);
});

test("fetch failure falls back to a valid cache; with no cache it fails", async () => {
  const cacheDir = dir();
  const none = await resolveRemotePolicy({ source, cacheDir, fetch: async () => { throw new Error("offline"); } });
  assert.ok(!none.ok);
  writeCache(cacheDir, bundle(2));
  const r = await resolveRemotePolicy({ source, cacheDir, fetch: async () => { throw new Error("offline"); } });
  assert.ok(r.ok);
  assert.equal(r.origin, "cache");
  assert.equal(r.serial, 2);
  assert.match(r.warnings.join(" "), /cached policy/);
});

test("a corrupted cache is ignored with a warning", async () => {
  const cacheDir = dir();
  mkdirSync(join(cacheDir, "policy"));
  writeFileSync(join(cacheDir, "policy", "remote-policy.json"), "garbage");
  assert.equal(readCache(cacheDir, k.pub).kind, "invalid");
  const r = await resolveRemotePolicy({ source, cacheDir, fetch: reply(bundle(1)) });
  assert.ok(r.ok);
  assert.equal(r.origin, "fetched");
  assert.match(r.warnings.join(" "), /cached policy ignored/);
});

test("rollback uses the cache; equal or higher serial replaces it", async () => {
  const cacheDir = dir();
  writeCache(cacheDir, bundle(5));
  const old = await resolveRemotePolicy({ source, cacheDir, fetch: reply(bundle(4)) });
  assert.ok(old.ok);
  assert.equal(old.origin, "cache");
  assert.match(old.warnings.join(" "), /rollback/);
  const same = await resolveRemotePolicy({ source, cacheDir, fetch: reply(bundle(5)) });
  assert.ok(same.ok && same.origin === "fetched");
  const newer = bundle(6);
  const up = await resolveRemotePolicy({ source, cacheDir, fetch: reply(newer) });
  assert.ok(up.ok && up.origin === "fetched" && up.serial === 6);
  assert.equal(readFileSync(join(cacheDir, "policy", "remote-policy.json"), "utf8"), newer);
});

test("a badly signed fetch never wins over the cache and is not cached", async () => {
  const cacheDir = dir();
  const r = await resolveRemotePolicy({ source, cacheDir, fetch: reply(bundle(1, pair().priv)) });
  assert.ok(!r.ok);
  assert.equal(readCache(cacheDir, k.pub).kind, "none");
});

test("the key can come from a file", async () => {
  const r = await resolveRemotePolicy({ source: { url: source.url, publicKeyFile: "/k.pem", refreshMinutes: 60 }, cacheDir: dir(), fetch: reply(bundle()), readKeyFile: () => k.pub });
  assert.ok(r.ok);
  const bad = await resolveRemotePolicy({ source: { url: source.url, publicKeyFile: "/k.pem", refreshMinutes: 60 }, cacheDir: dir(), fetch: reply(bundle()), readKeyFile: () => { throw new Error("x"); } });
  assert.ok(!bad.ok);
});

test("fetchBundle: byte cap, non-2xx, redirect mode, http non-loopback", async () => {
  const big = await fetchBundle("https://a.example/p", { fetch: reply("x".repeat(100)), maxBytes: 50 });
  assert.ok(!big.ok && /too large/.test(big.reason));
  const bad = await fetchBundle("https://a.example/p", { fetch: reply("no", 404) });
  assert.ok(!bad.ok && /404/.test(bad.reason));
  let init: RequestInit | undefined;
  await fetchBundle("https://a.example/p", { fetch: async (_u, i) => ((init = i), new Response("{}")) });
  assert.equal(init?.redirect, "error");
  let called = false;
  const http = await fetchBundle("http://a.example/p", { fetch: async () => ((called = true), new Response("{}")) });
  assert.ok(!http.ok);
  assert.equal(called, false);
  assert.ok((await fetchBundle("http://127.0.0.1:1/p", { fetch: reply("{}") })).ok);
});

const io = (text: string): PolicyIo => ({ exists: () => true, read: () => text });
const load = (policySource: unknown) => loadManagedPolicy({ PISTA_POLICY_FILE: "/p.json" }, "linux", io(JSON.stringify({ version: 1, policySource })));

test("policySource schema", () => {
  const ok = load({ url: "https://p.example/x", publicKey: "PEM", refreshMinutes: 5 });
  assert.equal(ok.failure, undefined);
  assert.deepEqual(ok.remote, { url: "https://p.example/x", publicKey: "PEM", refreshMinutes: 15 });
  assert.equal(load({ url: "https://p.example/x", publicKeyFile: "/k" }).remote?.refreshMinutes, 60);
  assert.ok(load({ url: "http://p.example/x", publicKey: "PEM" }).failure);
  assert.ok(load({ url: "http://localhost:1/x", publicKey: "PEM" }).remote);
  assert.ok(load({ url: "https://p.example/x" }).failure);
  assert.ok(load({ url: "https://p.example/x", publicKey: "a", publicKeyFile: "b" }).failure);
  assert.ok(load("nope").failure);
});

test("policySource.refreshMinutes bounds", () => {
  const src = (refreshMinutes: unknown) => load({ url: "https://p.example/x", publicKey: "PEM", refreshMinutes });
  assert.equal(src(1).remote?.refreshMinutes, 15);
  assert.equal(src(10080).remote?.refreshMinutes, 10080);
  for (const bad of [0, -5, 10081, 35792, 1e9, 1.5, Infinity, "60"]) assert.match(src(bad).failure ?? "", /refreshMinutes must be an integer from 1 to 10080/, String(bad));
});

test("remoteSourceFromEnv", () => {
  assert.equal(remoteSourceFromEnv({}), null);
  assert.ok("failure" in remoteSourceFromEnv({ PISTA_POLICY_URL: "https://p.example/x" })!);
  assert.ok("failure" in remoteSourceFromEnv({ PISTA_POLICY_PUBLIC_KEY: "k" })!);
  assert.ok("failure" in remoteSourceFromEnv({ PISTA_POLICY_URL: "http://p.example/x", PISTA_POLICY_PUBLIC_KEY: "k" })!);
  const pem = remoteSourceFromEnv({ PISTA_POLICY_URL: "https://p.example/x", PISTA_POLICY_PUBLIC_KEY: k.pub })!;
  assert.ok("source" in pem && pem.source.publicKey === k.pub.trim());
  const file = remoteSourceFromEnv({ PISTA_POLICY_URL: "https://p.example/x", PISTA_POLICY_PUBLIC_KEY: "/etc/k.pem" })!;
  assert.ok("source" in file && file.source.publicKeyFile === "/etc/k.pem");
});

test("private-key, certificate and multi-block PEMs are not accepted as the public key", () => {
  assert.ok(!verifyBundle(bundle(), k.priv).ok);
  const cert = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
  assert.ok(!verifyBundle(bundle(), cert).ok);
  assert.ok(!verifyBundle(bundle(), k.pub + k.pub).ok);
  assert.ok(!verifyBundle(bundle(), k.pub + cert).ok);
});

test("a 63-byte signature is rejected", () => {
  const r = verifyBundle(mutate(bundle(), (e) => (e.signature = Buffer.alloc(63, 1).toString("base64"))), k.pub);
  assert.ok(!r.ok && /64 bytes/.test(r.reason));
});

test("the signature is checked before the payload is parsed", () => {
  const payload = Buffer.from("{not json");
  const forged = JSON.stringify({ format: "pista-signed-policy/1", payload: payload.toString("base64"), signature: Buffer.alloc(64, 2).toString("base64") });
  const r = verifyBundle(forged, k.pub);
  assert.ok(!r.ok && /signature/.test(r.reason));
});

test("an invalid cache is ignored and a valid fetch is accepted and cached", async () => {
  const cacheDir = dir();
  writeCache(cacheDir, bundle(9, pair().priv));
  const fresh = bundle(1);
  const r = await resolveRemotePolicy({ source, cacheDir, fetch: reply(fresh) });
  assert.ok(r.ok && r.origin === "fetched" && r.serial === 1);
  assert.equal(readFileSync(join(cacheDir, "policy", "remote-policy.json"), "utf8"), fresh);
});
