// Policy from a URL: IT publishes a signed bundle on its own HTTPS URL; the host fetches it, verifies an Ed25519
// signature, refuses to go back to an older serial and keeps the last good bundle in a cache. Pure core: no boot wiring.
// Reason strings are fixed on purpose; they never echo payload content.
// Accepted limits: the cache is user-writable, so deleting it removes the rollback floor (an older bundle still needs
// IT's signature, so IT should not leave old bundles at the URL). A cache has no maximum age: a stale but valid bundle stays in force.
import { createPrivateKey, createPublicKey, randomUUID, sign, verify, type KeyObject } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parsePolicy, type LoadedPolicy, type RemoteSource, DEFAULT_REFRESH_MINUTES, validPolicyUrl } from "./policy.ts";
import { isRecord } from "./secrets.ts";

export const BUNDLE_FORMAT = "pista-signed-policy/1";

export type VerifyResult = { ok: true; policy: LoadedPolicy; serial: number } | { ok: false; reason: string };

function publicKeyOf(pem: string): KeyObject | null {
  if ((pem.match(/-----BEGIN [A-Z ]+-----/g) ?? []).join() !== "-----BEGIN PUBLIC KEY-----") return null; // exactly one SPKI block: no private key, cert or extra blocks
  try {
    const key = createPublicKey({ key: pem, format: "pem", type: "spki" });
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

const validSerial = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Strict envelope parse, signature check, then (only after a valid signature) the policy payload. */
export function verifyBundle(text: string, publicKeyPem: string, label = "remote policy"): VerifyResult {
  const key = publicKeyOf(publicKeyPem);
  if (!key) return { ok: false, reason: "public key is not a valid Ed25519 public key" };
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    return { ok: false, reason: "bundle is not valid JSON" };
  }
  if (!isRecord(envelope) || envelope.format !== BUNDLE_FORMAT) return { ok: false, reason: "bundle has the wrong format" };
  if (typeof envelope.payload !== "string" || typeof envelope.signature !== "string") return { ok: false, reason: "bundle payload or signature is missing" };
  const payload = Buffer.from(envelope.payload, "base64");
  const signature = Buffer.from(envelope.signature, "base64");
  if (payload.toString("base64") !== envelope.payload || signature.toString("base64") !== envelope.signature) return { ok: false, reason: "bundle base64 is not canonical" };
  if (signature.length !== 64) return { ok: false, reason: "signature must be 64 bytes" };
  if (!verify(null, payload, key, signature)) return { ok: false, reason: "signature does not match" };
  const payloadText = payload.toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    return { ok: false, reason: "signed payload is not valid JSON" };
  }
  if (!isRecord(parsed)) return { ok: false, reason: "signed payload is not an object" };
  if (!validSerial(parsed.serial)) return { ok: false, reason: 'signed payload needs an integer "serial" of 0 or more' };
  if (parsed.policySource !== undefined) return { ok: false, reason: 'signed payload must not contain "policySource"' };
  const { serial, ...rest } = parsed;
  const policy = parsePolicy(JSON.stringify(rest), label, "url", []);
  if (policy.failure) return { ok: false, reason: "signed payload is not a valid policy" };
  return { ok: true, policy, serial };
}

/** Wraps policy JSON (with an integer `serial`) in a signed envelope. Throws a plain Error on bad input. */
export function signBundle(policyJsonText: string, privateKeyPem: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(policyJsonText);
  } catch {
    throw new Error("policy file is not valid JSON");
  }
  if (!isRecord(parsed) || !validSerial(parsed.serial)) throw new Error('policy needs an integer "serial" of 0 or more');
  let key: KeyObject;
  try {
    key = createPrivateKey(privateKeyPem);
  } catch {
    throw new Error("private key could not be read");
  }
  if (key.asymmetricKeyType !== "ed25519") throw new Error("private key must be Ed25519");
  const payload = Buffer.from(policyJsonText, "utf8");
  const bundle = JSON.stringify({ format: BUNDLE_FORMAT, payload: payload.toString("base64"), signature: sign(null, payload, key).toString("base64") });
  // Refuse anything the host would refuse: verify with the public key derived from the private one.
  const check = verifyBundle(bundle, createPublicKey(key).export({ type: "spki", format: "pem" }) as string);
  if (!check.ok) throw new Error(check.reason);
  return bundle;
}

export interface FetchOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

/** GET with no redirects (https cannot be downgraded), a timeout and a byte cap. */
export async function fetchBundle(url: string, opts: FetchOptions = {}): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  if (!validPolicyUrl(url)) return { ok: false, reason: "policy URL must be https" };
  const { fetch: doFetch = fetch, timeoutMs = 10_000, maxBytes = 1_048_576 } = opts;
  try {
    const res = await doFetch(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, reason: `policy server answered HTTP ${res.status}` };
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.byteLength;
        if (total > maxBytes) return { ok: false, reason: "policy bundle is too large" };
        chunks.push(chunk);
      }
    }
    return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
  } catch {
    return { ok: false, reason: "policy could not be fetched" };
  }
}

const cachePath = (cacheDir: string) => join(cacheDir, "policy", "remote-policy.json");

/** Atomic write of the envelope exactly as fetched. */
export function writeCache(cacheDir: string, text: string): void {
  const file = cachePath(cacheDir);
  const dir = join(cacheDir, "policy");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, text, { mode: 0o600 });
    renameSync(tmp, file);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

export type CacheRead = { kind: "none" } | { kind: "invalid"; reason: string } | { kind: "ok"; result: Extract<VerifyResult, { ok: true }>; ageMs: number };

/** Re-verifies on every read; a cache that no longer verifies is reported, not used. */
export function readCache(cacheDir: string, publicKeyPem: string): CacheRead {
  const file = cachePath(cacheDir);
  let text: string;
  let mtimeMs: number; // cache age is the file mtime: it is the time of the last accepted fetch, which is what the age should mean
  try {
    text = readFileSync(file, "utf8");
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return { kind: "none" };
  }
  const result = verifyBundle(text, publicKeyPem);
  return result.ok ? { kind: "ok", result, ageMs: Math.max(0, Date.now() - mtimeMs) } : { kind: "invalid", reason: result.reason };
}

export type RemoteResolution =
  | { ok: true; origin: "fetched" | "cache"; serial: number; policy: LoadedPolicy; warnings: string[]; cacheAgeMs?: number }
  | { ok: false; reason: string; warnings: string[] };

export interface ResolveOptions {
  source: RemoteSource;
  cacheDir: string;
  fetch?: typeof fetch;
  readKeyFile?: (path: string) => string;
  /** Do not write the cache (`pista policy check`). */
  readOnly?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

/** fetch -> verify -> anti-rollback -> cache. Never returns an unsigned or badly signed policy. */
export async function resolveRemotePolicy(opts: ResolveOptions): Promise<RemoteResolution> {
  const { source, cacheDir } = opts;
  const warnings: string[] = [];
  let pem = source.publicKey;
  if (pem === undefined && source.publicKeyFile !== undefined) {
    try {
      pem = (opts.readKeyFile ?? ((p: string) => readFileSync(p, "utf8")))(source.publicKeyFile);
    } catch {
      return { ok: false, reason: "policy public key file cannot be read", warnings };
    }
  }
  if (pem === undefined || !publicKeyOf(pem)) return { ok: false, reason: "policy public key is not a valid Ed25519 public key", warnings };

  const cache = readCache(cacheDir, pem);
  if (cache.kind === "invalid") warnings.push(`cached policy ignored: ${cache.reason}`);
  const cached = cache.kind === "ok" ? cache : null;
  const fromCache = (why: string): RemoteResolution => {
    if (!cached) return { ok: false, reason: why, warnings };
    const hours = Math.round(cached.ageMs / 360_000) / 10;
    warnings.push(`${why}; using the cached policy (serial ${cached.result.serial}, ${hours} h old)`);
    return { ok: true, origin: "cache", serial: cached.result.serial, policy: cached.result.policy, warnings, cacheAgeMs: cached.ageMs };
  };

  const fetched = await fetchBundle(source.url, { fetch: opts.fetch, timeoutMs: opts.timeoutMs, maxBytes: opts.maxBytes });
  if (!fetched.ok) return fromCache(fetched.reason);
  const verified = verifyBundle(fetched.text, pem, source.url);
  if (!verified.ok) return fromCache(`fetched policy rejected: ${verified.reason}`);
  if (cached && verified.serial < cached.result.serial) return fromCache(`fetched policy rejected: serial ${verified.serial} is older than the cached ${cached.result.serial} (rollback)`);
  if (!opts.readOnly) {
    try {
      writeCache(cacheDir, fetched.text);
    } catch {
      warnings.push("policy cache could not be written");
    }
  }
  return { ok: true, origin: "fetched", serial: verified.serial, policy: verified.policy, warnings };
}

/** PISTA_POLICY_URL + PISTA_POLICY_PUBLIC_KEY (PEM, or a path when the value does not start with -----BEGIN). Env wins over the policy field. */
export function remoteSourceFromEnv(env: NodeJS.ProcessEnv): { source: RemoteSource } | { failure: string } | null {
  const url = env.PISTA_POLICY_URL?.trim();
  const key = env.PISTA_POLICY_PUBLIC_KEY?.trim();
  if (!url) return key ? { failure: "PISTA_POLICY_PUBLIC_KEY is set without PISTA_POLICY_URL" } : null;
  if (!validPolicyUrl(url)) return { failure: "PISTA_POLICY_URL must be an https URL (http only for localhost)" };
  if (!key) return { failure: "PISTA_POLICY_URL needs PISTA_POLICY_PUBLIC_KEY" };
  return { source: { url, refreshMinutes: DEFAULT_REFRESH_MINUTES, ...(key.startsWith("-----BEGIN") ? { publicKey: key } : { publicKeyFile: key }) } };
}

/** Where the cache lives when the host's own PISTA_HOME constant is not at hand (the CLI). */
export const defaultCacheDir = (env: NodeJS.ProcessEnv): string => env.PISTA_HOME ?? join(homedir(), ".pista");
