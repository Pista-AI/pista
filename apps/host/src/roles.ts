import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { reportFormatPrompt } from "./brief.ts";
import type { AgentOverride, AgentRole, AgentRoleName, BuiltinAgentRoleName, HostConfig } from "@pista/protocol";

export const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];

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
    description: "Read-only research: reads, greps and lists files, then reports what it found, including existing helpers that fit the task (file and export).",
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

/** Default and upper bound of the loop guard's per-run tool-call cap. */
export const DEFAULT_MAX_TOOL_CALLS = 60;
const MAX_TOOL_CALLS_LIMIT = 1000;

/** A usable tool-call cap (positive integer, at most 1000), or undefined so the caller keeps its default. */
export function validToolCallLimit(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= MAX_TOOL_CALLS_LIMIT ? (value as number) : undefined;
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
      ...(validToolCallLimit(o.maxToolCalls) ? { maxToolCalls: o.maxToolCalls } : {}),
      // An allowlist that intersects to nothing would read as "unrestricted", so the role is switched off instead.
      ...(o.disabled || (o.tools && tools.length === 0) ? { disabled: true } : {}),
    };
  }
  return out;
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
    reportFormatPrompt(role),
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

/** Tools a top-level thread keeps in orchestrator mode; undefined when the mode is off. */
export function orchestratorTools(mode: HostConfig["orchestratorMode"]): string[] | undefined {
  if (mode === "delegate") return ["agent", "plan"];
  if (mode === "delegate-read") return ["agent", "plan", ...READ_ONLY_TOOLS];
  return undefined;
}

/** Blocks tools outside `allowed` for an orchestrator thread, including nested codemode calls (see `roleGateExtension`). */
export function orchestratorGateExtension(allowed: readonly string[]): InlineExtension {
  return {
    name: "orchestrator-gate",
    factory: (pi: ExtensionAPI) => {
      pi.on("tool_call", (event) => {
        if (allowed.includes(event.toolName)) return undefined;
        return { block: true, reason: `Blocked: orchestrator mode only allows ${allowed.join(", ")}. Delegate this work to a sub-agent with the agent tool.` };
      });
    },
  };
}

/** System-prompt section for an orchestrator top-level thread; children never get it. */
export function orchestratorPrompt(mode: HostConfig["orchestratorMode"]): string {
  if (mode === "sliced") return ""; // its prompt section arrives with the mode's tools; this is not the delegate text
  if (mode === "lead") {
    return [
      "## Lead mode",
      "Make small edits yourself. Delegate exploration and large or parallel changes to sub-agents with the `agent` tool.",
      "In a brief, give the goal, pointers (files, helpers to reuse) and acceptance; never code. The sub-agent reads the code and writes it.",
    ].join("\n");
  }
  return [
    "## Orchestrator mode",
    mode === "delegate-read"
      ? "You can read files but not edit them or run commands; sub-agents make changes through the `agent` tool and you get their reports."
      : "You cannot read or edit files yourself; sub-agents do the work through the `agent` tool and you get their reports.",
    "For a change: send an explorer to locate it, then an implementer with the explorer's findings (as pointers), a goal and an acceptance command; never code. An explorer's report is not the result: do not end your turn until an implementer has made the change and reported, or you have told the user why it cannot be done.",
    "If a report is incomplete or a check failed, send a follow-up with continueId.",
    ...(mode === "delegate-read"
      ? ["Before you end, read the changed lines and compare them with the request (names, scope, what must not change); if they differ, send the implementer a follow-up."]
      : []),
  ].join("\n");
}
