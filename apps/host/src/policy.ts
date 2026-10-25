import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { posix, resolve, win32 } from "node:path";
import type { HostConfig, ManagedPolicy, McpServerConfig, PolicyGateway } from "@pista/protocol";
import { DEFAULT_OIDC_SCOPES } from "./policy-sso.ts";
import { EXPOSURES, fromRaw, validateServers } from "./mcp-entries.ts";
import { mcpKey } from "./policy-access.ts";
import { parseMcpRule } from "./policy-tools.ts";

export interface LoadedPolicy {
  policy: ManagedPolicy | null;
  /** Path the policy was read from; null when there is none. */
  source: string | null;
  warnings: string[];
  /** True when the policy's MCP part cannot be trusted: the file failed to load, or the `mcp` section is malformed. The host then leaves what it installed earlier in place. */
  mcpUntrusted?: boolean;
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
  defaultThinkingMode: "enum",
  instructions: "string",
  linkTarget: "enum",
  memoryEnabled: "boolean",
  webSearchEnabled: "boolean",
  localServers: "array",
  llamaEnabled: "boolean",
  maxOutputTokens: "number",
};

// Keep in step with the protocol unions ApprovalMode, LinkTarget, ThinkingMode, AgentRoleName and LocalServerKind (none is exported as an array).
const ENUMS: Partial<Record<keyof HostConfig, readonly string[]>> = {
  approvalMode: ["full-access", "ask-writes", "read-only"],
  linkTarget: ["builtin", "home", "external"],
  defaultThinkingMode: ["auto", "off", "minimal", "low", "medium", "high", "xhigh"],
};
const ROLES = ["explorer", "implementer", "reviewer"];
const SERVER_KINDS = ["lmstudio", "ollama", "llamacpp", "openai"];

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isModelRef = (value: unknown): boolean => isRecord(value) && typeof value.provider === "string" && typeof value.id === "string";
const isServer = (value: unknown): boolean =>
  isRecord(value) && typeof value.id === "string" && typeof value.name === "string" && typeof value.baseUrl === "string" && SERVER_KINDS.includes(value.kind as string);

/** Checks the shape of the nested settings; the top-level kind has been checked already. */
function validNested(key: keyof HostConfig, value: unknown): boolean {
  if (key === "defaultModel") return isModelRef(value);
  if (key === "localServers") return (value as unknown[]).every(isServer);
  if (key === "agentRoles") return Object.entries(value as Record<string, unknown>).every(([role, v]) => ROLES.includes(role) && isRecord(v) && isModelRef(v.model));
  return true;
}

/** mcpServers live in Pi's mcp.json, not in config.json; a policy declares them in its `mcp` section instead. */
const UNSUPPORTED: ReadonlyArray<keyof HostConfig> = ["mcpServers"];

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
const looksLikeSecret = (value: string) => value.length > 40 && !/^(\/|\.\/|~|https?:)/.test(value) && !/\$\{?[A-Za-z_]/.test(value);

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

/** Policy file candidates in precedence order: the env override alone, else the platform's location. */
function candidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): { paths: string[]; explicit: boolean } {
  if (env.PISTA_POLICY_FILE) return { paths: [env.PISTA_POLICY_FILE], explicit: true };
  if (platform === "darwin") return { paths: ["/Library/Application Support/Pista/managed-policy.json"], explicit: false };
  if (platform === "win32") return { paths: env.ProgramData ? [win32.join(env.ProgramData, "Pista", "managed-policy.json")] : [], explicit: false };
  return { paths: [posix.join("/etc/pista", "managed-policy.json")], explicit: false };
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
      warnings.push(`${name}.${key}: not supported here, use the "mcp" section, ignored`);
    } else {
      const k = key as keyof HostConfig;
      const want = KEYS[k];
      const choices = ENUMS[k];
      if (k === "maxOutputTokens" && value === null) out[key] = undefined; // null means no cap; an own undefined key still overrides a stored value
      else if (want === "enum" ? !choices?.includes(value as string) : kindOf(value) !== want || !validNested(k, value)) warnings.push(`${name}.${key}: wrong type or value, ignored`);
      else if (k === "maxOutputTokens" && !(Number.isSafeInteger(value) && (value as number) > 0)) warnings.push(`${name}.${key}: must be a positive integer, ignored`);
      else out[key] = value;
    }
  }
  return out as Partial<HostConfig>;
}

/** Reads the managed policy; never throws and never writes. Problems come back as warnings and the file is then ignored or trimmed. */
export function loadManagedPolicy(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, io: PolicyIo = realIo): LoadedPolicy {
  const warnings: string[] = [];
  const { paths, explicit } = candidates(env, platform);
  // A relative PISTA_POLICY_FILE is resolved against the working directory; symlinks are followed so the log names the real file.
  const found = paths.map((path) => (explicit ? resolve(path) : path)).find((path) => io.exists(path)) ?? null;
  if (!found) {
    if (explicit) warnings.push(`PISTA_POLICY_FILE ${resolve(paths[0]!)} does not exist, no policy applied`);
    return { policy: null, source: null, warnings, ...(explicit ? { mcpUntrusted: true } : {}) };
  }
  let source = found;
  let parsed: unknown;
  try {
    source = io.realpath?.(found) ?? found;
    const mode = platform === "win32" ? null : io.mode?.(source) ?? null;
    if (mode !== null && (mode & 0o022) !== 0) warnings.push(`${source}: writable by group or others, anyone who can edit it can change the policy`);
    parsed = JSON.parse(io.read(source));
  } catch (error) {
    warnings.push(`${source}: cannot read policy (${(error as Error).message}), no policy applied`);
    return { policy: null, source: null, warnings, mcpUntrusted: true };
  }
  if (kindOf(parsed) !== "object" || (parsed as { version?: unknown }).version !== 1) {
    warnings.push(`${source}: "version" must be 1, no policy applied`);
    return { policy: null, source: null, warnings, mcpUntrusted: true };
  }
  const file = parsed as Record<string, unknown>;
  for (const key of Object.keys(file)) if (!["version", "locked", "defaults", "providers", "models", "mcp", "extensions", "tools"].includes(key)) warnings.push(`${key}: unknown top-level key, ignored`);
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
    if (untrusted.value) return { policy, source, warnings, mcpUntrusted: true };
  }
  if (file.extensions !== undefined) {
    const section = extensionsSection(file.extensions, warnings);
    if (section) policy.extensions = section;
  }
  if (file.tools !== undefined) policy.tools = toolsSection(file.tools, warnings);
  return { policy, source, warnings };
}
