import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { posix, resolve, win32 } from "node:path";
import type { HostConfig, ManagedPolicy, McpServerConfig, PolicyGateway } from "@pista/protocol";
import { DEFAULT_OIDC_SCOPES } from "./policy-sso.ts";
import { EXPOSURES, fromRaw, validateServers } from "./mcp-entries.ts";
import { mcpKey } from "./policy-access.ts";
import { parseMcpRule } from "./policy-tools.ts";
import { compareVersions, parseVersion } from "./semver.ts";
import { normalizeDomainPattern } from "@pista/pi-browser/domains";
import { auditSection } from "./audit-policy.ts";
import { validToolCallLimit } from "./roles.ts";
import { isTierRef, TIER_NAME } from "./model-tiers.ts";
import { validSliced } from "./harness/sliced/validate.ts";
import { HARNESS_CONFIG_VALIDATORS } from "./harness/validators.ts";
import { isRecord, looksLikeSecret } from "./secrets.ts";
import { readMdmPolicy, type CommandRunner, type LstatFn } from "./policy-mdm.ts";

export type PolicySourceKind = "env-file" | "mdm" | "file" | "url";

/** Where a signed policy bundle is fetched from (the `policySource` block, or PISTA_POLICY_URL). */
export interface RemoteSource {
  url: string;
  publicKey?: string;
  publicKeyFile?: string;
  refreshMinutes: number;
}

export const DEFAULT_REFRESH_MINUTES = 60;
const MIN_REFRESH_MINUTES = 15;
export const MAX_REFRESH_MINUTES = 10080;

/** https only; plain http just for loopback (tests). */
export function validPolicyUrl(text: string): boolean {
  try {
    const u = new URL(text);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Validates the `policySource` block; every problem is pushed to `problems` (a policy that points at a URL must not be ignored silently). */
export function policySourceSection(raw: unknown, problems: string[]): RemoteSource | undefined {
  const before = problems.length;
  const text = (what: string): KeyCheck<Partial<RemoteSource>> => (v) => (typeof v === "string" && v.trim() ? undefined : what);
  const out = strictBlock<Partial<RemoteSource>>(raw, "policySource", problems, {
    url: (v, o) => (typeof v === "string" && validPolicyUrl(v) ? void (o.url = v) : "must be an https URL (http only for localhost)"),
    publicKey: (v, o) => text("must be a PEM string")(v, o) ?? void (o.publicKey = v as string),
    publicKeyFile: (v, o) => text("must be a path")(v, o) ?? void (o.publicKeyFile = v as string),
    refreshMinutes: (v, o) => (intIn(v, 1, MAX_REFRESH_MINUTES) ? void (o.refreshMinutes = Math.max(MIN_REFRESH_MINUTES, v)) : `must be an integer from 1 to ${MAX_REFRESH_MINUTES}`),
  });
  if (isRecord(raw)) {
    if (raw.url === undefined) problems.push("policySource.url must be an https URL (http only for localhost)");
    if ((raw.publicKey === undefined) === (raw.publicKeyFile === undefined)) problems.push("policySource needs exactly one of publicKey and publicKeyFile");
  }
  if (problems.length > before) return undefined;
  return { ...out, refreshMinutes: out.refreshMinutes ?? DEFAULT_REFRESH_MINUTES } as RemoteSource;
}

export interface LoadedPolicy {
  policy: ManagedPolicy | null;
  /** Path the policy was read from; null when there is none. */
  source: string | null;
  /** Which of the three places the policy came from; null when none was found. */
  sourceKind: PolicySourceKind | null;
  warnings: string[];
  /** True when the policy's MCP part cannot be trusted: the file failed to load, or the `mcp` section is malformed. The host then leaves what it installed earlier in place. */
  mcpUntrusted?: boolean;
  /** Set when the host must not start: the policy file exists but is broken, or `PISTA_REQUIRE_POLICY=1` and there is none. */
  failure?: string;
  /** True when `failure` is only "PISTA_REQUIRE_POLICY=1 but no policy found"; a remote source from the environment may still satisfy it. */
  missing?: boolean;
  /** The `policySource` block, when the policy names a URL to fetch the real policy from. */
  remote?: RemoteSource;
}

/** File access, injectable so tests need no real files. `read` throws like readFileSync. */
export interface PolicyIo {
  exists(path: string): boolean;
  read(path: string): string;
  /** Canonical path of an existing file; identity in tests. */
  realpath?(path: string): string;
  /** Permission bits of an existing file, or null where there are none to check. */
  mode?(path: string): number | null;
}

const realIo: PolicyIo = {
  exists: existsSync,
  read: (path) => readFileSync(path, "utf8"),
  realpath: realpathSync,
  mode: (path) => statSync(path).mode,
};

type Kind = "string" | "boolean" | "number" | "array" | "object" | "enum";

/** Every HostConfig key and the JSON type its value must have. The Record type makes the compiler flag a new key. */
const KEYS: Record<keyof HostConfig, Kind> = {
  homeUrl: "string",
  mcpServers: "array",
  approvalMode: "enum",
  defaultModel: "object",
  agentRoles: "object",
  agentOverrides: "object",
  modelTiers: "object",
  defaultThinkingMode: "enum",
  orchestratorMode: "enum",
  sliced: "object",
  harness: "string",
  harnessConfig: "object",
  instructions: "string",
  linkTarget: "enum",
  memoryEnabled: "boolean",
  webSearchEnabled: "boolean",
  browserEnabled: "boolean",
  maxToolCalls: "number",
  contextWindowCap: "number",
  localServers: "array",
  llamaEnabled: "boolean",
  maxOutputTokens: "number",
  verify: "object",
};

// Keep in step with the protocol unions ApprovalMode, LinkTarget, ThinkingMode, AgentRoleName and LocalServerKind (none is exported as an array).
const ENUMS: Partial<Record<keyof HostConfig, readonly string[]>> = {
  approvalMode: ["full-access", "ask-writes", "read-only"],
  linkTarget: ["builtin", "home", "external"],
  orchestratorMode: ["off", "delegate", "delegate-read", "lead", "sliced"],
  defaultThinkingMode: ["auto", "off", "minimal", "low", "medium", "high", "xhigh"],
};
const ROLES = ["explorer", "implementer", "reviewer"];
const SERVER_KINDS = ["lmstudio", "ollama", "llamacpp", "openai"];

const isModelRef = (value: unknown): boolean => isRecord(value) && typeof value.provider === "string" && typeof value.id === "string";
/** A concrete model or a `tier:<name>` reference (a role's model). */
const isModelSpec = (value: unknown): boolean => isModelRef(value) || isTierRef(value);
const isServer = (value: unknown): boolean =>
  isRecord(value) && typeof value.id === "string" && typeof value.name === "string" && typeof value.baseUrl === "string" && SERVER_KINDS.includes(value.kind as string);

const isNonEmpty = (v: unknown) => typeof v === "string" && v.trim() !== "";
const isStrings = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === "string");
const validOverride = (v: unknown): boolean =>
  isRecord(v) &&
  (v.model === undefined || isModelSpec(v.model)) &&
  (v.thinking === undefined || (typeof v.thinking === "string" && ENUMS.defaultThinkingMode!.includes(v.thinking) && v.thinking !== "auto")) &&
  (v.tools === undefined || isStrings(v.tools)) &&
  (v.excludeTools === undefined || isStrings(v.excludeTools)) &&
  (v.maxToolCalls === undefined || validToolCallLimit(v.maxToolCalls) !== undefined) &&
  (v.disabled === undefined || typeof v.disabled === "boolean");

/** Checks the shape of the nested settings; the top-level kind has been checked already. */
function validNested(key: keyof HostConfig, value: unknown): boolean {
  if (key === "defaultModel") return isModelRef(value);
  if (key === "localServers") return (value as unknown[]).every(isServer);
  if (key === "agentRoles") return Object.entries(value as Record<string, unknown>).every(([role, v]) => ROLES.includes(role) && isRecord(v) && isModelSpec(v.model));
  if (key === "modelTiers") return !Array.isArray(value) && Object.entries(value as Record<string, unknown>).every(([name, v]) => TIER_NAME.test(name) && isRecord(v) && isNonEmpty(v.provider) && isNonEmpty(v.id));
  if (key === "agentOverrides") return Object.values(value as Record<string, unknown>).every(validOverride);
  if (key === "harness") return isNonEmpty(value);
  if (key === "sliced") return validSliced(value);
  if (key === "harnessConfig") return Object.entries(value as Record<string, unknown>).every(([id, v]) => isRecord(v) && (HARNESS_CONFIG_VALIDATORS[id]?.(v) ?? true));
  return true;
}

/** mcpServers live in Pi's mcp.json, not in config.json; a policy declares them in its `mcp` section instead. contextWindowCap is eval-only. */
const UNSUPPORTED: ReadonlyArray<keyof HostConfig> = ["mcpServers", "contextWindowCap"];

function kindOf(value: unknown): Kind | "null" {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : (typeof value as Kind);
}

/** Provider ids a gateway must not take regardless of what is registered: Nebius, the llama.cpp runtime, the local server kinds and the `local-` prefix. Collisions with Pi's built-ins are caught at registration time. */
const RESERVED_PROVIDER_IDS: readonly string[] = ["nebius", "llama.cpp", ...SERVER_KINDS];
const GATEWAY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

const positiveInt = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

/** The URL without a trailing slash when it is usable, else null: https (http for local hosts only), no credentials, query or fragment. */
function cleanBaseUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.includes(url.hostname))) return null;
    if (url.username || url.password || url.search || url.hash || raw.includes("?") || raw.includes("#")) return null;
    return raw.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** A long value without an environment reference is probably a secret that belongs in an environment variable. Paths and URLs are not. */

/** Validates a gateway's `auth` block; a string is the reason it is unusable. Scopes are returned with the defaults merged in. */
function oidcAuth(raw: unknown, warnings: string[], at: string): NonNullable<PolicyGateway["auth"]> | string {
  if (!isRecord(raw) || raw.type !== "oidc") return '"auth.type" must be "oidc"';
  for (const key of Object.keys(raw)) if (!["type", "issuer", "clientId", "scopes", "token", "audience"].includes(key)) warnings.push(`${at}.auth.${key}: unknown setting, ignored`);
  let issuer: URL | undefined;
  try {
    issuer = typeof raw.issuer === "string" ? new URL(raw.issuer) : undefined;
  } catch {
    issuer = undefined;
  }
  if (!issuer || issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash) return '"auth.issuer" must be an https URL without credentials, query or fragment';
  if (typeof raw.clientId !== "string" || !raw.clientId.trim()) return '"auth.clientId" must be a non-empty string';
  if (raw.scopes !== undefined && (!Array.isArray(raw.scopes) || !raw.scopes.every((x) => typeof x === "string" && x.trim() && !/\s/.test(x)))) return '"auth.scopes" must be an array of non-empty strings without spaces';
  if (raw.token !== undefined && raw.token !== "id" && raw.token !== "access") return '"auth.token" must be "id" or "access"';
  if (raw.audience !== undefined && (typeof raw.audience !== "string" || !raw.audience.trim())) return '"auth.audience" must be a non-empty string';
  return {
    type: "oidc",
    issuer: raw.issuer as string,
    clientId: raw.clientId.trim(),
    scopes: [...new Set([...DEFAULT_OIDC_SCOPES, ...((raw.scopes as string[] | undefined) ?? [])])],
    ...(raw.token ? { token: raw.token } : {}),
    ...(raw.audience ? { audience: raw.audience as string } : {}),
  };
}

/** Validates `providers.gateways`; a bad entry is dropped with a warning, the rest stay. */
function gateways(raw: unknown, warnings: string[]): PolicyGateway[] {
  if (!Array.isArray(raw)) {
    warnings.push('providers.gateways: must be an array, ignored');
    return [];
  }
  const out: PolicyGateway[] = [];
  raw.forEach((entry, index) => {
    const at = `providers.gateways[${index}]`;
    const drop = (why: string) => void warnings.push(`${at}: ${why}, gateway ignored`);
    if (!isRecord(entry)) return drop("must be an object");
    const { id, name, kind, baseUrl, apiKeyEnv, headers, models, auth } = entry;
    if (typeof id !== "string" || !id.trim()) return drop('missing "id"');
    if (!GATEWAY_ID.test(id)) return drop(`id "${id}" may only contain letters, digits, ".", "_" and "-"`);
    if (RESERVED_PROVIDER_IDS.includes(id) || id.startsWith("local-")) return drop(`id "${id}" is reserved`);
    if (out.some((g) => g.id === id)) return drop(`duplicate id "${id}"`);
    if (typeof name !== "string" || !name.trim()) return drop('missing "name"');
    if (kind !== "openai-compatible" && kind !== "anthropic-compatible") return drop('"kind" must be "openai-compatible" or "anthropic-compatible"');
    const cleanUrl = typeof baseUrl === "string" ? cleanBaseUrl(baseUrl) : null;
    if (!cleanUrl) return drop('"baseUrl" must be an https URL without credentials, query or fragment (http only for localhost or 127.0.0.1)');
    if (apiKeyEnv !== undefined && (typeof apiKeyEnv !== "string" || !ENV_NAME.test(apiKeyEnv))) return drop('"apiKeyEnv" must be an environment variable name');
    if (auth !== undefined && apiKeyEnv !== undefined) return drop('"apiKeyEnv" and "auth" are mutually exclusive');
    const oidc = auth === undefined ? undefined : oidcAuth(auth, warnings, at);
    if (typeof oidc === "string") return drop(oidc);
    if (headers !== undefined && !isRecord(headers)) return drop('"headers" must be an object');
    if (!Array.isArray(models)) return drop('"models" must be a non-empty array');
    const safeHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries((headers ?? {}) as Record<string, unknown>)) {
      if (typeof value !== "string") warnings.push(`${at}.headers.${key}: must be a string, ignored`);
      else if (value.startsWith("!")) return drop(`header "${key}" starts with "!", which Pi would run as a shell command; use a literal or a "$ENV" reference`);
      else {
        // The file is readable by users; a long literal here is probably a secret that belongs in an environment variable.
        if (looksLikeSecret(value)) warnings.push(`${at}.headers.${key}: looks like a literal secret, use a "$ENV" reference instead`);
        if (Object.keys(safeHeaders).some((k) => k.toLowerCase() === key.toLowerCase())) warnings.push(`${at}.headers.${key}: differs only by case from another header`);
        safeHeaders[key] = value;
      }
    }
    const usable: PolicyGateway["models"] = [];
    for (const m of models) {
      if (!isRecord(m) || typeof m.id !== "string" || !m.id.trim()) warnings.push(`${at}.models: entry without an "id", ignored`);
      else if (usable.some((u) => u.id === m.id)) warnings.push(`${at}.models: duplicate model "${m.id}", ignored`);
      else {
        const model: PolicyGateway["models"][number] = { id: m.id };
        if (typeof m.name === "string") model.name = m.name;
        if (typeof m.reasoning === "boolean") model.reasoning = m.reasoning;
        for (const key of ["contextWindow", "maxTokens"] as const) {
          if (m[key] === undefined) continue;
          if (positiveInt(m[key])) model[key] = m[key];
          else warnings.push(`${at}.models "${m.id}".${key}: must be a positive integer, ignored`);
        }
        if (model.maxTokens && model.contextWindow && model.maxTokens > model.contextWindow) warnings.push(`${at}.models "${m.id}": maxTokens exceeds contextWindow`);
        usable.push(model);
      }
    }
    if (!usable.length) return drop("has no usable models");
    out.push({ id, name, kind, baseUrl: cleanUrl, ...(apiKeyEnv ? { apiKeyEnv } : {}), ...(oidc ? { auth: oidc } : {}), ...(Object.keys(safeHeaders).length ? { headers: safeHeaders } : {}), models: usable });
  });
  return out;
}

/** Validates an allowlist: trimmed non-empty strings (and, with `pattern`, matching it); bad entries are dropped with a warning. */
function allowList(raw: unknown, at: string, warnings: string[], pattern?: RegExp): string[] {
  // A wrong-typed list fails closed: it counts as an empty list, which allows nothing.
  if (!Array.isArray(raw)) {
    warnings.push(`${at}: must be an array of strings, treated as an empty list (allows nothing)`);
    return [];
  }
  const out: string[] = [];
  for (const entry of raw) {
    const text = typeof entry === "string" ? entry.trim() : "";
    if (!text) warnings.push(`${at}: entry must be a non-empty string, ignored`);
    else if (pattern && !pattern.test(text)) warnings.push(`${at}: "${text}" must look like "provider/id" or "provider/*", ignored`);
    else out.push(text);
  }
  return out;
}

const MODEL_PATTERN = /^[^/\s]+\/\S+$/;

/** Validates the `providers` section. */
function providers(raw: unknown, warnings: string[]): ManagedPolicy["providers"] {
  if (!isRecord(raw)) {
    warnings.push('"providers" must be an object, ignored');
    return undefined;
  }
  for (const key of Object.keys(raw)) if (!["gateways", "allow", "disableDirectLogin"].includes(key)) warnings.push(`providers.${key}: unknown setting, ignored`);
  const out: NonNullable<ManagedPolicy["providers"]> = {};
  if (raw.gateways !== undefined) out.gateways = gateways(raw.gateways, warnings);
  if (raw.allow !== undefined) {
    // Unknown ids are warned about at startup (index.ts), where Pi's provider registry is known.
    out.allow = allowList(raw.allow, "providers.allow", warnings);
  }
  if (raw.disableDirectLogin !== undefined) {
    if (typeof raw.disableDirectLogin === "boolean") out.disableDirectLogin = raw.disableDirectLogin;
    else warnings.push("providers.disableDirectLogin: must be a boolean, treated as false");
  }
  return out;
}

/** Validates the `models` section. */
function modelsSection(raw: unknown, warnings: string[]): ManagedPolicy["models"] {
  if (!isRecord(raw)) {
    warnings.push('"models" must be an object, ignored');
    return undefined;
  }
  for (const key of Object.keys(raw)) if (key !== "allow") warnings.push(`models.${key}: unknown setting, ignored`);
  return raw.allow === undefined ? {} : { allow: allowList(raw.allow, "models.allow", warnings, MODEL_PATTERN) };
}

const isStringMap = (v: unknown) => isRecord(v) && Object.values(v).every((x) => typeof x === "string");

/** Why Pi would reject this raw entry although `fromRaw` can read it, or undefined. `fromRaw` drops wrong-typed values silently, which would leave a managed server dead. */
function rawProblem(entry: Record<string, unknown>): string | undefined {
  if (entry.type !== undefined && !["stdio", "http", "streamable-http"].includes(entry.type as string)) return '"type" must be "stdio", "http" or "streamable-http" ("sse" is not supported)';
  if (entry.exposure !== undefined && !EXPOSURES.includes(entry.exposure as string)) return `"exposure" must be one of ${EXPOSURES.join(", ")}`;
  if (entry.enabled !== undefined && typeof entry.enabled !== "boolean") return '"enabled" must be a boolean';
  if (entry.description !== undefined && typeof entry.description !== "string") return '"description" must be a string';
  if (entry.cwd !== undefined && typeof entry.cwd !== "string") return '"cwd" must be a string';
  if (entry.timeout !== undefined && !(typeof entry.timeout === "number" && entry.timeout > 0)) return '"timeout" must be a positive number of seconds';
  const tools = entry.toolExposure;
  if (tools !== undefined && !(isRecord(tools) && Object.values(tools).every((v) => EXPOSURES.includes(v as string)))) return `"toolExposure" must map tool names to one of ${EXPOSURES.join(", ")}`;
  return undefined;
}

/** Validates the `mcp` section. A bad server is dropped with a warning; a name that is also blocked counts as blocked. */
function mcpSection(raw: unknown, warnings: string[], untrusted: { value: boolean }): ManagedPolicy["mcp"] {
  if (!isRecord(raw)) {
    untrusted.value = true;
    warnings.push('"mcp" must be an object, ignored');
    return undefined;
  }
  for (const key of Object.keys(raw)) if (!["servers", "allowUserServers", "blockedServers"].includes(key)) warnings.push(`mcp.${key}: unknown setting, ignored`);
  const out: NonNullable<ManagedPolicy["mcp"]> = {};
  if (raw.allowUserServers !== undefined) {
    if (typeof raw.allowUserServers === "boolean") out.allowUserServers = raw.allowUserServers;
    else warnings.push("mcp.allowUserServers: must be a boolean, treated as true");
  }
  const blocked: string[] = [];
  if (raw.blockedServers !== undefined) {
    if (!Array.isArray(raw.blockedServers)) {
      untrusted.value = true;
      warnings.push("mcp.blockedServers: must be an array of strings, ignored");
    } else
      for (const name of raw.blockedServers) {
        if (typeof name === "string" && name.trim()) blocked.push(name.trim());
        else warnings.push("mcp.blockedServers: entry must be a non-empty string, ignored");
      }
    out.blockedServers = blocked;
  }
  if (raw.servers !== undefined) {
    out.servers = {};
    if (!isRecord(raw.servers)) {
      untrusted.value = true;
      warnings.push("mcp.servers: must be an object keyed by server name, ignored");
    } else {
      const accepted: McpServerConfig[] = [];
      for (const [name, entry] of Object.entries(raw.servers)) {
        const at = `mcp.servers.${name}`;
        const drop = (why: string) => void warnings.push(`${at}: ${why}, server ignored`);
        const config = fromRaw(name, entry);
        if (!isRecord(entry) || !config) {
          drop('needs a "command" or a "url"');
          continue;
        }
        if (entry.args !== undefined && !(Array.isArray(entry.args) && entry.args.every((a) => typeof a === "string"))) { drop('"args" must be a list of strings'); continue; }
        if ((entry.env !== undefined && !isStringMap(entry.env)) || (entry.headers !== undefined && !isStringMap(entry.headers))) { drop('"env" and "headers" must map names to strings'); continue; }
        const problem = rawProblem(entry) ?? validateServers([...accepted, config]);
        if (problem) { drop(problem); continue; }
        if (blocked.some((b) => mcpKey(b) === mcpKey(name))) {
          warnings.push(`${at}: also in mcp.blockedServers, treated as blocked`);
          continue;
        }
        const values = [...(Array.isArray(entry.args) ? (entry.args as string[]) : []), ...Object.values((entry.env ?? {}) as Record<string, string>), ...Object.values((entry.headers ?? {}) as Record<string, string>)];
        if (values.some(looksLikeSecret)) warnings.push(`${at}: an arg, env or header value looks like a literal secret, use a "\${ENV}" reference instead`);
        accepted.push(config);
        out.servers[name] = entry;
      }
    }
  }
  return out;
}

const NPM_EXACT = /^npm:(?:@[^/@\s]+\/)?[^/@\s]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const GIT_SOURCE = /^(?:git:|(?:https?|ssh|git):\/\/)/i;

/** Whether a git source names a ref, as Pi reads it: after `#`, or after an `@` in the repository path (`git:github.com/org/repo@v1`). */
function gitHasRef(source: string): boolean {
  const hash = source.lastIndexOf("#");
  if (hash >= 0) return hash < source.length - 1;
  let rest = source.replace(/^git:/i, "");
  const scp = rest.match(/^git@[^:]+:(.*)$/);
  if (scp) rest = scp[1]!;
  else if (rest.includes("://")) rest = rest.replace(/^[a-z]+:\/\/[^/]*/i, "");
  else rest = rest.slice(rest.indexOf("/") + 1);
  const at = rest.indexOf("@");
  return at > 0 && at < rest.length - 1;
}

/** Validates the `extensions` section. npm and git sources must be pinned (the only integrity control Pi offers); a bad entry is dropped with a warning. */
function extensionsSection(raw: unknown, warnings: string[]): ManagedPolicy["extensions"] {
  if (!isRecord(raw)) {
    warnings.push('"extensions" must be an object, ignored');
    return undefined;
  }
  for (const key of Object.keys(raw)) if (!["packages", "allowUserPackages"].includes(key)) warnings.push(`extensions.${key}: unknown setting, ignored`);
  const out: NonNullable<ManagedPolicy["extensions"]> = {};
  if (raw.allowUserPackages !== undefined) {
    if (typeof raw.allowUserPackages === "boolean") out.allowUserPackages = raw.allowUserPackages;
    else warnings.push("extensions.allowUserPackages: must be a boolean, treated as true");
  }
  if (raw.packages !== undefined) {
    out.packages = [];
    if (!Array.isArray(raw.packages)) warnings.push("extensions.packages: must be an array of strings, ignored");
    else
      for (const entry of raw.packages) {
        const source = typeof entry === "string" ? entry.trim() : "";
        const drop = (why: string) => void warnings.push(`extensions.packages: "${source}" ${why}, package ignored`);
        if (!source) warnings.push("extensions.packages: entry must be a non-empty string, ignored");
        else if (out.packages.includes(source)) warnings.push(`extensions.packages: duplicate "${source}", ignored`);
        else if (source.startsWith("npm:") && !NPM_EXACT.test(source)) drop('must pin an exact version, e.g. "npm:name@1.2.3"');
        else if (GIT_SOURCE.test(source) && !gitHasRef(source)) drop('must pin a ref (tag or commit), e.g. "git:github.com/org/repo#v1.2.3"');
        else {
          if (!source.startsWith("npm:") && !GIT_SOURCE.test(source)) warnings.push(`extensions.packages: "${source}" is a local path, it must exist on every machine`);
          out.packages.push(source);
        }
      }
  }
  return out;
}

/** Startup log suffix; empty without an `extensions` section. */
export function extensionsSummary(policy: ManagedPolicy | null): string {
  const section = policy?.extensions;
  return section ? `, ${section.packages?.length ?? 0} ${section.packages?.length === 1 ? "package" : "packages"}${section.allowUserPackages === false ? ", user packages disabled" : ""}` : "";
}

type Rules = { allow?: string[]; deny?: string[] };

/** Validates one `allow`/`deny` pair. Security rules fail closed: a wrong-typed `allow` allows nothing and a wrong-typed `deny` denies everything. */
function ruleLists(raw: unknown, at: string, warnings: string[], keys: readonly string[] = []): Rules {
  if (!isRecord(raw)) {
    warnings.push(`${at}: must be an object, treated as { "deny": ["*"] } (denies everything)`);
    return { deny: ["*"] };
  }
  for (const key of Object.keys(raw)) if (!["allow", "deny", ...keys].includes(key)) warnings.push(`${at}.${key}: unknown setting, ignored`);
  const out: Rules = {};
  if (raw.allow !== undefined) out.allow = allowList(raw.allow, `${at}.allow`, warnings);
  if (raw.deny !== undefined) {
    if (Array.isArray(raw.deny)) out.deny = allowList(raw.deny, `${at}.deny`, warnings);
    else {
      warnings.push(`${at}.deny: must be an array of strings, treated as ["*"] (denies everything)`);
      out.deny = ["*"];
    }
  }
  return out;
}

/** Validates the `tools` section. A malformed section as a whole counts as "deny everything": a broken security rule must not open the gate. */
function toolsSection(raw: unknown, warnings: string[]): NonNullable<ManagedPolicy["tools"]> {
  const out: NonNullable<ManagedPolicy["tools"]> = ruleLists(raw, "tools", warnings, ["bash", "mcp", "skills"]);
  if (isRecord(raw)) for (const key of ["bash", "mcp", "skills"] as const) if (raw[key] !== undefined) out[key] = ruleLists(raw[key], `tools.${key}`, warnings);
  // Pi separates server and tool with "__", so a server name holding one cannot be matched exactly.
  for (const list of ["allow", "deny"] as const) {
    const entries = out.mcp?.[list];
    if (entries) out.mcp![list] = entries.filter((entry) => parseMcpRule(entry) !== null || void warnings.push(`tools.mcp.${list}: "${entry}" has "__" in the server name, ignored`));
  }
  return out;
}

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((x) => typeof x === "string" && x.trim() !== "");
const intIn = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const BAD_STRINGS = "must be an array of non-empty strings";
const BAD_BOOLEAN = "must be a boolean";

/** A per-key check for a strict block: stores a valid value in `out` and returns undefined, or returns the problem text that follows "<block>.<key> ". */
type KeyCheck<T> = (value: unknown, out: T) => string | undefined;

/** Shared shell of the strict policy blocks: a non-object or an unknown key is a problem, each known key goes to its check. Strict blocks stop the host on any problem (a dropped value would silently widen a policy). */
export function strictBlock<T extends object>(raw: unknown, name: string, problems: string[], checks: Record<string, KeyCheck<T>>): T {
  const out = {} as T;
  if (!isRecord(raw)) {
    problems.push(`"${name}" must be an object`);
    return out;
  }
  for (const [key, value] of Object.entries(raw)) {
    const check = Object.hasOwn(checks, key) ? checks[key] : undefined;
    if (!check) problems.push(`${name}.${key}: unknown setting`);
    else {
      const bad = check(value, out);
      if (bad) problems.push(`${name}.${key}${bad.startsWith(":") ? "" : " "}${bad}`);
    }
  }
  return out;
}

const boolKey = <T extends object>(key: keyof T & string): KeyCheck<T> => (v, out) => (typeof v === "boolean" ? void ((out as Record<string, unknown>)[key] = v) : BAD_BOOLEAN);

/** Validates `network`. A bad value stops the host: a dropped proxy or CA would silently send traffic the admin meant to route elsewhere. */
function networkSection(raw: unknown, problems: string[]): NonNullable<ManagedPolicy["network"]> {
  type N = NonNullable<ManagedPolicy["network"]>;
  const list = (key: "noProxy" | "caCertFiles"): KeyCheck<N> => (v, out) => (strings(v) ? void (out[key] = v) : BAD_STRINGS);
  return strictBlock<N>(raw, "network", problems, {
    proxy: (v, out) => {
      let ok = false;
      try {
        ok = typeof v === "string" && ["http:", "https:"].includes(new URL(v).protocol);
      } catch {}
      return ok ? void (out.proxy = v as string) : "must be an http(s) URL";
    },
    noProxy: list("noProxy"),
    caCertFiles: list("caCertFiles"),
    useSystemCa: boolKey<N>("useSystemCa"),
  });
}

function telemetrySection(raw: unknown, problems: string[]): NonNullable<ManagedPolicy["telemetry"]> {
  type T = NonNullable<ManagedPolicy["telemetry"]>;
  return strictBlock<T>(raw, "telemetry", problems, { piTelemetry: boolKey<T>("piTelemetry"), versionCheck: boolKey<T>("versionCheck") });
}

/** Validates `browser`; fail-closed like `network`: a dropped entry would widen an allowlist or lift a block. */
function browserSection(raw: unknown, problems: string[], warnings: string[]): NonNullable<ManagedPolicy["browser"]> {
  type B = NonNullable<ManagedPolicy["browser"]>;
  const domains = (key: "allowedDomains" | "deniedDomains"): KeyCheck<B> => (value, out) => {
    if (!strings(value)) return BAD_STRINGS;
    const bad = value.filter((v) => normalizeDomainPattern(v) === null);
    if (bad.length) return `: ${bad.map((b) => JSON.stringify(b)).join(", ")} must be a host like "example.com" or "*.example.com" (no scheme, port, path or regex)`;
    out[key] = [...new Set(value.map((v) => normalizeDomainPattern(v)!))];
    for (const p of out[key]!) if (/^\*\.[^.]+$/.test(p)) warnings.push(`browser.${key}: "${p}" covers a whole top-level domain`);
    return undefined;
  };
  return strictBlock<B>(raw, "browser", problems, { allowedDomains: domains("allowedDomains"), deniedDomains: domains("deniedDomains") });
}

/** Validates `retention`; fail-closed like `network`. Days are whole numbers from 1 to 3650. */
function retentionSection(raw: unknown, problems: string[]): NonNullable<ManagedPolicy["retention"]> {
  type R = NonNullable<ManagedPolicy["retention"]>;
  const days = (key: "sessionDays" | "traceDays"): KeyCheck<R> => (v, out) => (intIn(v, 1, 3650) ? void (out[key] = v) : "must be an integer from 1 to 3650");
  return strictBlock<R>(raw, "retention", problems, { sessionDays: days("sessionDays"), traceDays: days("traceDays"), purgeOnStartup: boolKey<R>("purgeOnStartup") });
}

/** Validates `updates`; fail-closed like `network`. Versions must be strict semver without a leading "v". */
function updatesSection(raw: unknown, problems: string[]): NonNullable<ManagedPolicy["updates"]> {
  type U = NonNullable<ManagedPolicy["updates"]>;
  const version = (key: "minimumVersion" | "maximumVersion"): KeyCheck<U> => (v, out) => (typeof v === "string" && parseVersion(v) ? void (out[key] = v) : 'must be a semver version like 1.2.3 (no leading "v")');
  const out = strictBlock<U>(raw, "updates", problems, {
    enabled: boolKey<U>("enabled"),
    channel: (v, o) => (v === "stable" || v === "beta" ? void (o.channel = v) : 'must be "stable" or "beta"'),
    feedUrl: (v, o) => {
      const clean = typeof v === "string" ? cleanBaseUrl(v) : null;
      return clean ? void (o.feedUrl = clean) : "must be an https URL (http only for localhost) without credentials, query or fragment";
    },
    minimumVersion: version("minimumVersion"),
    maximumVersion: version("maximumVersion"),
    enforcementHours: (v, o) => (intIn(v, 1, 720) ? void (o.enforcementHours = v) : "must be an integer from 1 to 720"),
  });
  const min = out.minimumVersion ? parseVersion(out.minimumVersion) : null;
  const max = out.maximumVersion ? parseVersion(out.maximumVersion) : null;
  if (min && max && compareVersions(min, max) > 0) problems.push("updates.minimumVersion must not be greater than updates.maximumVersion");
  return out;
}

/** Policy file candidates in precedence order: the env override alone, else the platform's location. */
export function candidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): { paths: string[]; explicit: boolean; kind: "env-file" | "file" } {
  if (env.PISTA_POLICY_FILE) return { paths: [env.PISTA_POLICY_FILE], explicit: true, kind: "env-file" };
  if (platform === "darwin") return { paths: ["/Library/Application Support/Pista/managed-policy.json"], explicit: false, kind: "file" };
  if (platform === "win32") return { paths: env.ProgramData ? [win32.join(env.ProgramData, "Pista", "managed-policy.json")] : [], explicit: false, kind: "file" };
  return { paths: [posix.join("/etc/pista", "managed-policy.json")], explicit: false, kind: "file" };
}

/** Validates one `locked`/`defaults` section, returning only the usable keys. */
function section(raw: unknown, name: string, warnings: string[]): Partial<HostConfig> {
  if (raw === undefined) return {};
  if (kindOf(raw) !== "object") {
    warnings.push(`"${name}" must be an object, ignored`);
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Object.hasOwn(KEYS, key)) {
      warnings.push(`${name}.${key}: unknown setting, ignored`);
    } else if (UNSUPPORTED.includes(key as keyof HostConfig)) {
      warnings.push(key === "mcpServers" ? `${name}.${key}: not supported here, use the "mcp" section, ignored` : `${name}.${key}: eval-only setting, not supported here, ignored`);
    } else {
      const k = key as keyof HostConfig;
      const want = KEYS[k];
      const choices = ENUMS[k];
      if (k === "maxOutputTokens" && value === null) out[key] = undefined; // null means no cap; an own undefined key still overrides a stored value
      else if (want === "enum" ? !choices?.includes(value as string) : kindOf(value) !== want || !validNested(k, value)) warnings.push(`${name}.${key}: wrong type or value, ignored`);
      else if (k === "maxOutputTokens" && !(Number.isSafeInteger(value) && (value as number) > 0)) warnings.push(`${name}.${key}: must be a positive integer, ignored`);
      else if (k === "maxToolCalls" && validToolCallLimit(value) === undefined) warnings.push(`${name}.${key}: must be a positive integer up to 1000, ignored`);
      else out[key] = value;
    }
  }
  return out as Partial<HostConfig>;
}

/** Reads the managed policy; never throws and never writes. Problems come back as warnings and the file is then ignored or trimmed.
 * One source is used, first found wins: PISTA_POLICY_FILE, then MDM (macOS managed preferences, Windows HKLM), then the platform file. */
export function loadManagedPolicy(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, io: PolicyIo = realIo, mdm: { run?: CommandRunner; lstat?: LstatFn } = {}): LoadedPolicy {
  const warnings: string[] = [];
  const { paths, explicit, kind } = candidates(env, platform);
  // A relative PISTA_POLICY_FILE is resolved against the working directory; symlinks are followed so the log names the real file.
  const resolved = paths.map((path) => (explicit ? resolve(path) : path));
  if (!explicit) {
    const m = readMdmPolicy(platform, env, mdm.run, mdm.lstat);
    if (m.kind === "error") return { policy: null, source: m.source, sourceKind: "mdm", warnings, mcpUntrusted: true, failure: `${m.source}: cannot read policy (${m.message})` };
    if (m.kind === "ok") return parsePolicy(m.text, m.source, "mdm", warnings);
    if (m.warnings) warnings.push(...m.warnings);
  }
  const file = resolved.find((path) => io.exists(path)) ?? null;
  if (!file) {
    if (explicit) warnings.push(`PISTA_POLICY_FILE ${resolve(paths[0]!)} does not exist, no policy applied`);
    const failure = env.PISTA_REQUIRE_POLICY === "1" ? `PISTA_REQUIRE_POLICY=1 but no managed policy was found (${[...(explicit ? [] : ["MDM"]), ...resolved].join(", ") || "no location for this platform"})` : undefined;
    return { policy: null, source: null, sourceKind: null, warnings, ...(explicit ? { mcpUntrusted: true } : {}), ...(failure ? { failure, ...(explicit ? {} : { missing: true }) } : {}) };
  }
    let source = file;
  let text: string;
  try {
    source = io.realpath?.(file) ?? file;
    const mode = platform === "win32" ? null : io.mode?.(source) ?? null;
    if (mode !== null && (mode & 0o022) !== 0) warnings.push(`${source}: writable by group or others, anyone who can edit it can change the policy`);
    text = io.read(source);
  } catch (error) {
    return { policy: null, source: null, sourceKind: null, warnings, mcpUntrusted: true, failure: `${source}: cannot read policy (${(error as Error).message})` };
  }
  return parsePolicy(text, source, kind, warnings);
}

/** Parses and validates policy text, whichever source it came from. */
export function parsePolicy(text: string, source: string, sourceKind: PolicySourceKind, warnings: string[]): LoadedPolicy {
  // A broken file reports no source (policy check then names the file it tried); a broken MDM policy keeps its source, there is no path to fall back on.
  const fail = (failure: string): LoadedPolicy => ({ policy: null, source: sourceKind === "mdm" ? source : null, sourceKind: sourceKind === "mdm" ? "mdm" : null, warnings, mcpUntrusted: true, failure });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail(`invalid JSON in ${source}`); // the parser's message can echo policy content, so it is not reported
  }
  if (kindOf(parsed) !== "object" || (parsed as { version?: unknown }).version !== 1) return fail(`${source}: "version" must be 1`);
  const file = parsed as Record<string, unknown>;
  for (const key of Object.keys(file)) if (!["version", "locked", "defaults", "providers", "models", "mcp", "extensions", "tools", "network", "telemetry", "browser", "updates", "audit", "retention", "policySource"].includes(key)) warnings.push(`${key}: unknown top-level key, ignored`);
  const policy: ManagedPolicy = { version: 1, locked: section(file.locked, "locked", warnings), defaults: section(file.defaults, "defaults", warnings) };
  if (file.providers !== undefined) {
    const section = providers(file.providers, warnings);
    if (section) policy.providers = section;
  }
  if (file.models !== undefined) {
    const section = modelsSection(file.models, warnings);
    if (section) policy.models = section;
  }
  if (file.mcp !== undefined) {
    const untrusted = { value: false };
    const section = mcpSection(file.mcp, warnings, untrusted);
    if (section) policy.mcp = section;
    if (untrusted.value) return { policy, source, sourceKind, warnings, mcpUntrusted: true };
  }
  if (file.extensions !== undefined) {
    const section = extensionsSection(file.extensions, warnings);
    if (section) policy.extensions = section;
  }
  if (file.tools !== undefined) policy.tools = toolsSection(file.tools, warnings);
  const problems: string[] = [];
  if (file.network !== undefined) policy.network = networkSection(file.network, problems);
  if (file.telemetry !== undefined) policy.telemetry = telemetrySection(file.telemetry, problems);
  if (file.browser !== undefined) policy.browser = browserSection(file.browser, problems, warnings);
  if (file.updates !== undefined) policy.updates = updatesSection(file.updates, problems);
  if (file.audit !== undefined) policy.audit = auditSection(file.audit, problems, warnings);
  if (file.retention !== undefined) policy.retention = retentionSection(file.retention, problems);
  const remote = file.policySource === undefined ? undefined : policySourceSection(file.policySource, problems);
  if (problems.length) return fail(`${source}: ${problems.join("; ")}`);
  return { policy, source, sourceKind, warnings, ...(remote ? { remote } : {}) };
}
