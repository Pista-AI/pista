import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import type { AgentOverride, AgentRole, AgentRoleName, BuiltinAgentRoleName, HostConfig, ManagedPolicy, ModelRef, ModelSpec } from "@pista/protocol";
import { isModelAllowed } from "./policy-access.ts";

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];

/**
 * Built-in sub-agent roles. An empty `tools` list means unrestricted (the implementer gets
 * everything the parent has). No role pins a default model: the parent's model is used unless
 * the user overrides it in `HostConfig.agentRoles`.
 */
export type RoleMap = Record<AgentRoleName, AgentRole>;

export const ROLES: Record<BuiltinAgentRoleName, AgentRole> & RoleMap = {
  explorer: {
    name: "explorer",
    tools: READ_ONLY_TOOLS,
    description: "Read-only research: reads, greps and lists files, then reports what it found.",
  },
  implementer: {
    name: "implementer",
    tools: [],
    description: "Makes changes: full tool set, same approvals as the parent.",
  },
  // Read-only for now; narrowing bash to a few git subcommands is not reliable through a name-level gate.
  reviewer: {
    name: "reviewer",
    tools: READ_ONLY_TOOLS,
    description: "Read-only review of files and changes, reports findings.",
  },
};

/** A role by name. A name no longer defined (its file was removed) falls back to read-only, so a stale child thread never gains tools. */
export function roleOf(role: AgentRoleName, roles: RoleMap = ROLES): AgentRole {
  return (Object.hasOwn(roles, role) ? roles[role] : undefined) ?? { name: role, tools: READ_ONLY_TOOLS, description: "Unknown role: read-only." };
}

/** The roles the agent tool offers and `spawn` accepts. */
export function availableRoles(roles: RoleMap = ROLES): AgentRole[] {
  return Object.values(roles).filter((r) => !r.disabled);
}

/** Roles with a tool allowlist also lose codemode, tool search, MCP and the browser. */
export function isRestrictedRole(role: AgentRoleName, roles: RoleMap = ROLES): boolean {
  return roleOf(role, roles).tools.length > 0;
}

/**
 * Applies `HostConfig.agentOverrides` to a role map. Tools can only narrow: an allowlist is intersected with the
 * role's own (an unrestricted role takes the override's list), and exclusions add up. Model is resolved separately.
 */
export function applyOverrides(roles: RoleMap, overrides: Record<string, AgentOverride> | undefined): RoleMap {
  if (!overrides) return roles;
  const out = { ...roles };
  for (const [name, o] of Object.entries(overrides)) {
    const role = Object.hasOwn(out, name) ? out[name] : undefined;
    if (!role || !o || typeof o !== "object") continue;
    const tools = o.tools ? (role.tools.length ? role.tools.filter((t) => o.tools!.includes(t)) : o.tools) : role.tools;
    out[name] = {
      ...role,
      tools,
      excludeTools: [...(role.excludeTools ?? []), ...(o.excludeTools ?? [])],
      ...(o.thinking ? { thinking: o.thinking } : {}),
      // An allowlist that intersects to nothing would read as "unrestricted", so the role is switched off instead.
      ...(o.disabled || (o.tools && tools.length === 0) ? { disabled: true } : {}),
    };
  }
  return out;
}

/** Tier names are short slugs: `local`, `cheap`, `standard`, `strong`, ... */
export const TIER_NAME = /^[a-z0-9][a-z0-9_-]*$/;

/** True for `tier:<name>` with a valid name. */
export function isTierRef(value: unknown): value is `tier:${string}` {
  return typeof value === "string" && value.startsWith("tier:") && TIER_NAME.test(value.slice(5));
}

/**
 * A concrete model passes through; `tier:<name>` becomes `tiers[name]`. An unknown or unmapped tier gives the
 * `fallback` (the caller's parent model) and a warning, never the next lower-precedence source.
 */
export function resolveModelTier(model: ModelSpec, tiers: HostConfig["modelTiers"], fallback?: ModelRef): { model: ModelRef | undefined; warning?: string } {
  if (typeof model !== "string") return { model };
  const name = model.slice(5);
  const tier = Object.hasOwn(tiers ?? {}, name) ? tiers![name] : undefined;
  if (tier?.provider && tier.id) return { model: tier };
  return { model: fallback, warning: `model tier "${name}" is not mapped in modelTiers; using the parent's model` };
}

/**
 * Model for a role: agentOverrides, agentRoles, the role's own default, then the parent's model; the first one set wins.
 * A `tier:<name>` value is resolved through `modelTiers` after that. A resolved model the policy disallows falls back to the parent's.
 */
export function resolveRoleModel(
  role: AgentRoleName,
  config: HostConfig,
  parentModel: ModelRef | undefined,
  policy?: ManagedPolicy | null,
  roles: RoleMap = ROLES,
  warn: (message: string) => void = (m) => console.warn(`[pista-host] ${m}`),
): ModelRef | undefined {
  const spec = config.agentOverrides?.[role]?.model ?? config.agentRoles?.[role]?.model ?? roleOf(role, roles).model;
  if (!spec) return parentModel;
  const { model: own, warning } = resolveModelTier(spec, config.modelTiers, parentModel);
  if (warning) warn(`${role}: ${warning}`);
  if (own && isModelAllowed(policy, own)) return own;
  if (own && typeof spec === "string") warn(`${role}: model tier "${spec.slice(5)}" resolves to ${own.provider}/${own.id}, which the policy disallows; using the parent's model`);
  return parentModel;
}

export function isToolAllowed(role: AgentRoleName, toolName: string, roles: RoleMap = ROLES): boolean {
  const { tools, excludeTools } = roleOf(role, roles);
  return (tools.length === 0 || tools.includes(toolName)) && !excludeTools?.includes(toolName);
}

/** Prompt addendum telling a child what it is; its final message is what the parent receives. A file role's text follows it, or replaces it with `promptMode: "replace"`. */
export function rolePrompt(role: AgentRoleName, roles: RoleMap = ROLES): string {
  const r = roleOf(role, roles);
  if (r.promptMode === "replace" && r.prompt) return r.prompt;
  return [
    `## Sub-agent role: ${role}`,
    `You are a ${role} sub-agent working for another agent. ${r.description}`,
    isRestrictedRole(role, roles) ? `You can only use these tools: ${r.tools.join(", ")}. Do not try to change anything.` : "",
    r.excludeTools?.length ? `You may not use these tools: ${r.excludeTools.join(", ")}.` : "",
    "Files you have read stay in your context; do not read a file again unless you edited it. Prefer grep to find the spot, then read once.",
    "Your final message is returned to the parent agent as your only output: make it a complete, concise report.",
    r.prompt ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Blocks tools outside the role's allowlist. Pi's `tools` option does not restrict nested calls
 * made by codemode scripts, but `tool_call` fires for those too, so the gate covers them.
 */
export function roleGateExtension(role: AgentRoleName, roles: RoleMap = ROLES): InlineExtension {
  return {
    name: "role-gate",
    factory: (pi: ExtensionAPI) => {
      pi.on("tool_call", (event) => {
        if (isToolAllowed(role, event.toolName, roles)) return undefined;
        const { tools, excludeTools } = roleOf(role, roles);
        return { block: true, reason: `Blocked: the ${role} role cannot use ${event.toolName}.${tools.length ? ` It may only use: ${tools.join(", ")}.` : ""}${excludeTools?.length ? ` It may not use: ${excludeTools.join(", ")}.` : ""}` };
      });
    },
  };
}
