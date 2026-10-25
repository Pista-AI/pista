import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import type { AgentRole, AgentRoleName, HostConfig, ManagedPolicy, ModelRef } from "@pista/protocol";
import { isModelAllowed } from "./policy-access.ts";

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];

/**
 * Built-in sub-agent roles. An empty `tools` list means unrestricted (the implementer gets
 * everything the parent has). No role pins a default model: the parent's model is used unless
 * the user overrides it in `HostConfig.agentRoles`.
 */
export const ROLES: Record<AgentRoleName, AgentRole> = {
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

/** Roles with a tool allowlist also lose codemode, tool search, MCP and the browser. */
export function isRestrictedRole(role: AgentRoleName): boolean {
  return ROLES[role].tools.length > 0;
}

/** Model for a role: user override, then the role's own default, then the parent's model. A role model the policy disallows falls back to the parent's. */
export function resolveRoleModel(role: AgentRoleName, config: HostConfig, parentModel: ModelRef | undefined, policy?: ManagedPolicy | null): ModelRef | undefined {
  const own = config.agentRoles?.[role]?.model ?? ROLES[role].model;
  return own && isModelAllowed(policy, own) ? own : parentModel;
}

export function isToolAllowed(role: AgentRoleName, toolName: string): boolean {
  const { tools } = ROLES[role];
  return tools.length === 0 || tools.includes(toolName);
}

/** Prompt addendum telling a child what it is; its final message is what the parent receives. */
export function rolePrompt(role: AgentRoleName): string {
  return [
    `## Sub-agent role: ${role}`,
    `You are a ${role} sub-agent working for another agent. ${ROLES[role].description}`,
    isRestrictedRole(role) ? `You can only use these tools: ${ROLES[role].tools.join(", ")}. Do not try to change anything.` : "",
    "Files you have read stay in your context; do not read a file again unless you edited it. Prefer grep to find the spot, then read once.",
    "Your final message is returned to the parent agent as your only output: make it a complete, concise report.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Blocks tools outside the role's allowlist. Pi's `tools` option does not restrict nested calls
 * made by codemode scripts, but `tool_call` fires for those too, so the gate covers them.
 */
export function roleGateExtension(role: AgentRoleName): InlineExtension {
  return {
    name: "role-gate",
    factory: (pi: ExtensionAPI) => {
      pi.on("tool_call", (event) => {
        if (isToolAllowed(role, event.toolName)) return undefined;
        return { block: true, reason: `Blocked: the ${role} role cannot use ${event.toolName}. It may only use: ${ROLES[role].tools.join(", ")}.` };
      });
    },
  };
}
