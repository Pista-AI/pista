import { isDeepStrictEqual } from "node:util";
import type { ManagedPolicy, McpServerConfig, ModelRef } from "@pista/protocol";

type Policy = ManagedPolicy | null | undefined;

/** True when `providers.allow` is absent or names the provider. */
export function isProviderAllowed(policy: Policy, providerId: string): boolean {
  const allow = policy?.providers?.allow;
  return !allow || allow.includes(providerId);
}

/** True when the provider is allowed and, if `models.allow` is set, an entry matches `provider/id` or `provider/*`. */
export function isModelAllowed(policy: Policy, ref: ModelRef): boolean {
  if (!isProviderAllowed(policy, ref.provider)) return false;
  const allow = policy?.models?.allow;
  return !allow || allow.includes(`${ref.provider}/${ref.id}`) || allow.includes(`${ref.provider}/*`);
}

/** True when the provider is a policy gateway that signs in through the organisation's identity provider. */
export function isSsoGateway(policy: Policy, providerId: string): boolean {
  return !!policy?.providers?.gateways?.some((g) => g.id === providerId && g.auth);
}

/**
 * False when the policy disables direct login or the provider is not allowed. A policy-declared SSO gateway
 * stays open to its own OAuth sign-in (any other login type, `type` given, is refused) even when direct login is disabled.
 */
export function isDirectLoginAllowed(policy: Policy, providerId: string, type?: "api_key" | "oauth"): boolean {
  if (!isProviderAllowed(policy, providerId)) return false;
  return !policy?.providers?.disableDirectLogin || (isSsoGateway(policy, providerId) && type !== "api_key");
}

/** Throws the policy error when `providers.allow` excludes the provider; for actions that would register or start one. */
export function assertProviderAllowed(policy: Policy, providerId: string): void {
  if (!isProviderAllowed(policy, providerId)) throw new Error(describeDenied(providerId));
}

/** True when any allowlist or the login switch is set, i.e. when the host has to filter. */
export function hasAccessRules(policy: Policy): boolean {
  return !!(policy?.providers?.allow || policy?.models?.allow || policy?.providers?.disableDirectLogin);
}

/** True when the policy restricts which models can be used. */
export function restrictsModels(policy: Policy): boolean {
  return !!(policy?.providers?.allow || policy?.models?.allow);
}

export function describeDenied(what: ModelRef | string): string {
  return `Not allowed by your organisation's policy: ${typeof what === "string" ? what : `${what.provider}/${what.id}`}`;
}

const modelKey = (m: ModelRef) => `${m.provider}/${m.id}`;

/** The error for "the policy allows models, but none of them can be used yet": names the gateway's key variable when there is one. */
function describeNoneConfigured(policy: Policy, allowed: ModelRef[]): string {
  const gateway = policy?.providers?.gateways?.find((g) => (g.apiKeyEnv || g.auth) && allowed.some((m) => m.provider === g.id));
  if (!gateway) return "No allowed model is configured";
  return gateway.auth ? `No allowed model is configured; sign in to ${gateway.name}` : `No allowed model is configured; set ${gateway.apiKeyEnv}`;
}

/**
 * The model a session should start on: `preferred` when the policy allows it, otherwise the first allowed
 * model in `available`: gateway models first (in policy order), then the rest sorted by provider/id.
 * `registered` is every model the registry knows, so "nothing is allowed" can be told from "allowed
 * models exist but none is configured". Throws in both cases. Without model restrictions `preferred` is returned unchanged.
 */
export function pickAllowedModel(policy: Policy, available: ModelRef[], preferred: ModelRef | undefined, registered: ModelRef[] = available): ModelRef | undefined {
  if (!restrictsModels(policy)) return preferred;
  if (preferred && isModelAllowed(policy, preferred)) return preferred;
  const gateways = policy?.providers?.gateways ?? [];
  const rank = (m: ModelRef) => {
    const i = gateways.findIndex((g) => g.id === m.provider);
    return i < 0 ? gateways.length : i;
  };
  const candidates = available
    .filter((m) => isModelAllowed(policy, m))
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === gateways.length ? modelKey(a).localeCompare(modelKey(b)) : 0));
  if (candidates[0]) return candidates[0];
  const allowedAtAll = registered.filter((m) => isModelAllowed(policy, m));
  throw new Error(allowedAtAll.length ? describeNoneConfigured(policy, allowedAtAll) : describeDenied(preferred ?? "no model is allowed"));
}

/** Startup log suffix; empty unless an allowlist or the login switch is set. */
export function accessSummary(policy: Policy): string {
  if (!hasAccessRules(policy)) return "";
  return `, allow ${policy?.providers?.allow?.length ?? "all"} providers / ${policy?.models?.allow?.length ?? "all"} models, direct login ${policy?.providers?.disableDirectLogin ? "off" : "on"}`;
}

/** Provider ids registered later or on demand (local servers, the llama.cpp runtime); allowing them is not a mistake. */
const LATE_PROVIDERS = ["lmstudio", "ollama", "llamacpp", "llama", "llama.cpp"];

/** Warnings for `providers.allow` entries that no registered provider (built-in or gateway) matches; the entries stay, Pi may register them later. */
export function unknownAllowedProviders(policy: Policy, registered: readonly string[]): string[] {
  return (policy?.providers?.allow ?? [])
    .filter((id) => !registered.includes(id) && !LATE_PROVIDERS.includes(id) && !id.startsWith("local-")).map((id) => `providers.allow: "${id}" is neither a built-in provider nor a declared gateway`);
}

/** What the policy says about MCP servers: names are compared with "-" and "_" as one character, as Pi does. */
export interface McpRules {
  managed: string[];
  blocked: string[];
  allowUserServers: boolean;
}

export const mcpKey = (name: string) => name.replace(/-/g, "_");

/** The MCP rules of a policy, or undefined without an `mcp` section. */
export function mcpRules(policy: Policy): McpRules | undefined {
  const mcp = policy?.mcp;
  return mcp ? { managed: Object.keys(mcp.servers ?? {}), blocked: mcp.blockedServers ?? [], allowUserServers: mcp.allowUserServers !== false } : undefined;
}

/** The denial text when replacing the server list `before` with `after` would touch a managed server, add a blocked one, or add any server while users may not; undefined when allowed. */
export function checkMcpChange(rules: McpRules | undefined, before: McpServerConfig[], after: McpServerConfig[]): string | undefined {
  if (!rules) return undefined;
  const find = (list: McpServerConfig[], name: string) => list.find((s) => mcpKey(s.name) === mcpKey(name));
  for (const name of rules.managed) {
    const was = find(before, name);
    const now = find(after, name);
    if (!isDeepStrictEqual(was, now)) return describeDenied(`${now && !was ? "adding" : now ? "changing" : "removing"} the managed MCP server "${name}"`);
  }
  for (const server of after) {
    if (find(before, server.name)) continue;
    if (rules.blocked.some((b) => mcpKey(b) === mcpKey(server.name))) return describeDenied(`the MCP server "${server.name}" is blocked`);
    if (!rules.allowUserServers) return describeDenied(`adding the MCP server "${server.name}" (adding MCP servers is managed)`);
  }
  return undefined;
}
