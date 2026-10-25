// `pista policy check`: loads the managed policy the way the host would at startup and reports whether it would
// start, without starting anything. Pure apart from reading the CA files the policy names.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { X509Certificate } from "node:crypto";
import type { ManagedPolicy, VersionGate } from "@pista/protocol";
import { evaluateVersionGate, resolveAppVersion } from "./version-gate.ts";
import { applyNetwork, maskUserinfo, redactProxy } from "./network.ts";
import { resolveAuditHeaders } from "./audit-policy.ts";
import { SECRET_WORDS, looksLikeSecret } from "./secrets.ts";
import { POLICY_USAGE, runPolicySign, type Out } from "./policy-cli.ts";
import { resolveBootPolicy } from "./policy-remote-boot.ts";
import { defaultCacheDir } from "./policy-remote.ts";
import { candidates, loadManagedPolicy, type LoadedPolicy, type PolicySourceKind } from "./policy.ts";

export interface PolicyCheckResult {
  status: "ok" | "warnings" | "fatal";
  exitCode: 0 | 1 | 2;
  source: string | null;
  /** Where the policy came from: PISTA_POLICY_FILE, MDM, or the platform file; null when none. */
  sourceKind: PolicySourceKind | null;
  fatal: string[];
  warnings: string[];
  /** The policy with secrets masked; null when no policy is in force. */
  effective: Record<string, unknown> | null;
  /** The running app version and what the policy's `updates` range makes of it. */
  appVersion: string;
  versionGate: VersionGate;
  /** Present when a remote policy source is configured: the live resolve. */
  remote?: { url: string; origin?: "fetched" | "cache"; serial?: number; cacheAgeMinutes?: number; error?: string };
}

const MASK = "***";
// Names of environment variables (apiKeyEnv, tokenEnv) are not secrets; the values they point at never appear in a policy.
// The secret word as the whole key or its final segment (authToken, api_key, --api-key), not inside another word (maxOutputTokens).
const SECRET_WHOLE = new RegExp(`(^|[_-])(${SECRET_WORDS})$`, "i");
const SECRET_CAMEL = /[a-z0-9](Token|Secret|Password|Passwd|ApiKey|Authorization|Credentials?|Bearer)$/;
const isSecretName = (key: string) => SECRET_WHOLE.test(key) || SECRET_CAMEL.test(key);
const secretKey = (key: string, value: unknown) => isSecretName(key) && !/env$/i.test(key) && !(key === "token" && (value === "id" || value === "access"));

function maskEntries(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) return Object.fromEntries(Object.keys(value).map((k) => [k, MASK]));
  return MASK;
}

/** URL credentials and query strings are masked (the query often carries tokens); other strings pass through. */
function redactString(text: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;
  try {
    const url = new URL(text);
    if (!url.username && !url.password && !url.search) return text;
    if (!url.search) return redactProxy(text);
    maskUserinfo(url).search = MASK;
    return url.toString();
  } catch {
    return text;
  }
}

/** Command-line arguments: the value after a secret-looking flag, `--flag=value` for such a flag, and secret-looking literals. */
function redactArgs(args: unknown[]): unknown[] {
  let after = false;
  return args.map((arg) => {
    if (typeof arg !== "string") return arg;
    const masked = after || looksLikeSecret(arg);
    after = false;
    const eq = /^(--?[\w-]+)=(.*)$/s.exec(arg);
    if (eq) return isSecretName(eq[1]!) ? `${eq[1]}=${MASK}` : redactString(masked ? MASK : arg);
    if (masked) return MASK;
    if (/^--?[\w-]+$/.test(arg) && isSecretName(arg)) after = true;
    return redactString(arg);
  });
}

/** Deep copy of the policy with header and env values, secret-looking keys, args and URL credentials/queries masked. Generic over every block. */
export function redactPolicy<T>(value: T, key = ""): T {
  // headersEnv maps header names to env var *names*; the names are not secrets.
  if (key === "headersEnv") return value;
  if (/^(headers|env)$/i.test(key) || secretKey(key, value)) return maskEntries(value) as T;
  if (typeof value === "string") return redactString(value) as T;
  if (Array.isArray(value)) return (key === "args" ? redactArgs(value) : value.map((item) => redactPolicy(item))) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactPolicy(v, k)])) as T;
  return value;
}

/** The network failures policy-boot would hit, without installing a dispatcher or changing the CA list. The proxy URL is already validated by the loader (policy.ts), which makes it fatal. */
function networkFailure(network: NonNullable<LoadedPolicy["policy"]>["network"]): string | null {
  if (!network) return null;
  for (const file of network.caCertFiles ?? []) {
    try {
      const pems = readFileSync(file, "utf8").match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
      if (!pems) return `network.caCertFiles: ${file} contains no PEM certificate`;
      for (const pem of pems) new X509Certificate(pem);
    } catch (error) {
      return `network.caCertFiles: cannot use ${file} (${(error as Error).message})`;
    }
  }
  return null;
}

/** The file that was tried: the loaded one, else the first candidate that exists (a broken file reports no source). */
function triedSource(loaded: LoadedPolicy, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, exists: (path: string) => boolean): { source: string | null; sourceKind: PolicySourceKind | null } {
  if (loaded.source && loaded.sourceKind) return { source: loaded.source, sourceKind: loaded.sourceKind };
  const { paths, explicit, kind } = candidates(env, platform);
  const source = paths.map((p) => (explicit ? resolve(p) : p)).find(exists) ?? null;
  return { source, sourceKind: source ? kind : null };
}

const statusOf = (fatal: string[], warnings: string[]): Pick<PolicyCheckResult, "status" | "exitCode"> =>
  fatal.length ? { status: "fatal", exitCode: 1 } : warnings.length ? { status: "warnings", exitCode: 2 } : { status: "ok", exitCode: 0 };

export function checkPolicy(loaded: LoadedPolicy, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (path: string) => boolean = existsSync): PolicyCheckResult {
  const fatal = [...(loaded.failure ? [loaded.failure] : [])];
  const warnings = [...loaded.warnings];
  if (!loaded.failure) resolveAuditHeaders(loaded.policy?.audit?.headersEnv, env, (w) => warnings.push(w));
  const appVersion = resolveAppVersion(env, (w) => warnings.push(w));
  const net = loaded.failure ? null : networkFailure(loaded.policy?.network);
  if (net) fatal.push(net);
  return {
    ...statusOf(fatal, warnings),
    ...triedSource(loaded, env, platform, exists),
    fatal,
    warnings,
    appVersion,
    versionGate: evaluateVersionGate(appVersion, loaded.policy?.updates),
    effective: loaded.policy ? (redactPolicy(loaded.policy) as unknown as Record<string, unknown>) : null,
  };
}

function versionGateLine(gate: VersionGate, current: string, updates: ManagedPolicy["updates"]): string {
  if (gate.status === "below") return `Version gate: BLOCKED (${current} below minimum ${gate.minimumVersion})`;
  if (gate.status === "above") return `Version gate: BLOCKED (${current} above maximum ${gate.maximumVersion})`;
  const bounds = [updates?.minimumVersion && `minimum ${updates.minimumVersion}`, updates?.maximumVersion && `maximum ${updates.maximumVersion}`].filter(Boolean);
  return `Version gate: ok (${current}; ${bounds.length ? bounds.join(", ") : "no version range"})`;
}

export function formatPolicyCheck(result: PolicyCheckResult): string {
  const lines = [`Policy source: ${result.sourceKind ? `${result.sourceKind} \u2014 ${result.source}` : "none"}`, `Status: ${result.status} (exit ${result.exitCode})`];
  if (result.fatal.length) lines.push("", "Fatal errors (the host would refuse to start):", ...result.fatal.map((f) => `  - ${f}`));
  if (result.warnings.length) lines.push("", "Warnings:", ...result.warnings.map((w) => `  - ${w}`));
  const { version: _version, locked, defaults, ...rest } = result.effective ?? {};
  const section = (title: string, values: unknown) => {
    if (!values || typeof values !== "object" || Object.keys(values).length === 0) return;
    lines.push("", `${title}:`, ...Object.entries(values).map(([k, v]) => `  ${k} = ${JSON.stringify(v)}`));
  };
  section("Locked", locked);
  section("Defaults", defaults);
  lines.push("", versionGateLine(result.versionGate, result.appVersion, (result.effective?.updates as ManagedPolicy["updates"]) ?? undefined));
  for (const [name, block] of Object.entries(rest)) lines.push("", `${name}: ${JSON.stringify(block)}`);
  return lines.join("\n");
}

/** Runs the `policy` subcommands (argv is what follows the program name) and returns the exit code.
 * For `check`, a configured remote source (PISTA_POLICY_URL or policySource) is resolved live, through the bootstrap policy's proxy/CA, without writing the cache. */
export async function runPolicyCheck(argv: string[], env: NodeJS.ProcessEnv, out: Out, deps: { fetch?: typeof fetch; cacheDir?: string } = {}): Promise<number> {
  const [, sub, ...flags] = argv;
  if (sub === "sign") return runPolicySign(flags, out);
  if (sub !== "check" || flags.some((f) => f !== "--json")) {
    out.error(POLICY_USAGE);
    return 64;
  }
  const loaded = loadManagedPolicy(env);
  let boot: Awaited<ReturnType<typeof resolveBootPolicy>> = { loaded };
  if (!loaded.failure || loaded.missing) {
    try {
      applyNetwork(loaded.policy?.network, env); // an unreadable CA file is reported as fatal by checkPolicy below
    } catch {}
    boot = await resolveBootPolicy({ env, loaded, cacheDir: deps.cacheDir ?? defaultCacheDir(env), fetch: deps.fetch, readOnly: true });
  }
  const result = checkPolicy(boot.loaded, env);
  if (boot.source) {
    result.remote = { url: boot.source.url, ...(boot.error ? { error: boot.error } : { origin: boot.origin, serial: boot.serial, ...(boot.cacheAgeMs !== undefined ? { cacheAgeMinutes: Math.round(boot.cacheAgeMs / 60_000) } : {}) }) };
    if (boot.loaded.sourceKind === "url") result.source = boot.loaded.source;
  }
  if (boot.failure && !result.fatal.includes(boot.failure)) result.fatal.push(boot.failure);
  Object.assign(result, statusOf(result.fatal, result.warnings));
  out.log(flags.includes("--json") ? JSON.stringify(result, null, 2) : formatPolicyCheck(result) + (result.remote ? `\n\nRemote policy: ${JSON.stringify(result.remote)}` : ""));
  return result.exitCode;
}
