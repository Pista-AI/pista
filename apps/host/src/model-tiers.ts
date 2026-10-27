import type { AgentRoleName, HostConfig, ManagedPolicy, ModelRef, ModelSpec } from "@pista/protocol";
import { isModelAllowed } from "./policy-access.ts";
import { ROLES, type RoleMap, roleOf } from "./roles.ts";

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
