import type { ManagedPolicy } from "@pista/protocol";

/** Why a call was refused: the rule that matched and the text the model and the user see. */
export interface Denial {
  rule: string;
  reason: string;
}

export interface ToolRules {
  /** Tool-name rules (`tools.allow` / `tools.deny`). */
  checkTool(toolName: string): Denial | null;
  /** Shell command rules (`tools.bash`), applied to every command unit. */
  checkBash(command: string): Denial | null;
  /** MCP rules (`tools.mcp`) for `mcp__<server>__<tool>` and the MCP resource tools (which name a server in `input`). */
  checkMcp(toolName: string, input?: unknown): Denial | null;
  /** Skill rules (`tools.skills`) over the skill's name. */
  skillAllowed(name: string): boolean;
}

/** Pista's own tools: always allowed under `tools.allow` (`tools.deny` still applies). Their nested calls are checked one by one. */
export const INTERNAL_TOOLS: readonly string[] = ["agent", "plan", "tool_search", "codemode"];
const MCP_RESOURCE_TOOLS = ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"];
const SHELL_TOOLS = ["bash", "powershell"];

const denial = (rule: string): Denial => ({ rule, reason: `Blocked by your organisation's policy: ${rule}` });

/** Commands longer than this are refused under any rule set: matching them is not worth the time, and a rule cannot be trusted on them. */
export const MAX_COMMAND_CHARS = 8192;

/**
 * Glob match with `*` (any run) and `?` (any one character), no other wildcards. Two pointers and one
 * backtrack position: O(pattern x text) in the worst case and never exponential. A trailing " *" also
 * matches the bare command, so "git push *" covers "git push".
 */
function matchGlob(pattern: string, text: string): boolean {
  const run = (p: string): boolean => {
    let pi = 0;
    let ti = 0;
    let star = -1;
    let mark = 0;
    while (ti < text.length) {
      if (p[pi] === "*") {
        star = pi++;
        mark = ti;
      } else if (pi < p.length && (p[pi] === "?" || p[pi] === text[ti])) {
        pi++;
        ti++;
      } else if (star >= 0) {
        pi = star + 1;
        ti = ++mark;
      } else return false;
    }
    while (p[pi] === "*") pi++;
    return pi === p.length;
  };
  const p = pattern.replace(/\*+/g, "*");
  return run(p) || (p.endsWith(" *") && run(p.slice(0, -2)));
}

/** The first pattern in `patterns` that matches any of `texts`, or undefined. `fold` compares in lower case. */
function compile(patterns: readonly string[] | undefined, fold = false): (...texts: string[]) => string | undefined {
  const rules = (patterns ?? []).map((pattern) => ({ pattern, glob: fold ? pattern.toLowerCase() : pattern }));
  return (...texts) => rules.find((r) => texts.some((t) => matchGlob(r.glob, fold ? t.toLowerCase() : t)))?.pattern;
}

// -- MCP ---------------------------------------------------------------------

/** Pi writes every character other than letters, digits and "_" as "_" in tool names. */
const normaliseMcp = (text: string) => text.replace(/[^A-Za-z0-9_*?]/g, "_").toLowerCase();
/** Pi appends `_<8 hex>` to tool names that collide or are too long. */
const withoutHash = (tool: string) => tool.replace(/_[0-9a-f]{8}$/i, "");

/** `mcp__<server>__<tool>` split at the first `__` after the prefix; null for any other name. */
export function parseMcpName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith("mcp__")) return null;
  const cut = name.indexOf("__", 5);
  return cut < 0 ? null : { server: name.slice(5, cut), tool: name.slice(cut + 2) };
}

/** An `mcp` entry as server and tool globs: "server" covers all its tools, "server/tool" one. Null when the server part contains "__" (Pi's own separator, so it cannot be matched exactly). */
export function parseMcpRule(entry: string): { server: string; tool: string | null } | null {
  const [server = "", ...rest] = entry.split("/");
  const tool = rest.join("/");
  const rule = { server: normaliseMcp(server), tool: tool ? normaliseMcp(tool) : null };
  return rule.server.includes("__") ? null : rule;
}

/** The first entry of `entries` matching this server and tool (`tool` null: a resource call, which only server-level entries match). `stripHash` also tries the tool without Pi's collision suffix. */
function mcpHit(entries: readonly string[] | undefined, server: string, tool: string | null, stripHash: boolean): string | undefined {
  const lower = tool?.toLowerCase();
  return (entries ?? []).find((entry) => {
    const rule = parseMcpRule(entry);
    if (!rule || !matchGlob(rule.server, server.toLowerCase())) return false;
    if (rule.tool === null) return true;
    return lower !== undefined && (matchGlob(rule.tool, lower) || (stripHash && matchGlob(rule.tool, withoutHash(lower))));
  });
}

// -- Shell commands ----------------------------------------------------------

const MAX_DEPTH = 4;
const KEYWORDS = /^(?:(?:if|then|else|elif|do|while|until|time|!|\{)\s+)+/;
const ASSIGNMENT = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/;
/** Programs that run the rest of the line: looked through for deny rules only. */
const WRAPPER = /^(?:(?:command|builtin|exec|nohup|time|xargs|env|setsid|stdbuf|doas|sudo|nice|timeout)\s+(?:(?:-\S+|\d+(?:\.\d+)?[smhd]?)\s+)*|ssh\s+(?:-\S+\s+)*\S+\s+)/;
/** Lines that end a compound command and run nothing themselves. */
const NOT_A_COMMAND = /^(?:fi|done|esac|else|\})$/;
const SHELL_PREFIX = String.raw`(?:^|[\s;&|(\`])(?:\S*\/)?(?:busybox\s+)?`;
const QUOTED = String.raw`(?:'([^']*)'|"((?:[^"\\]|\\.)*)"`;
const SHELL_C = new RegExp(
  `${SHELL_PREFIX}(?:ba|z|da|k|fi|c|tc|a)?sh(?:\\s+--?[A-Za-z][\\w-]*)*?\\s+-[A-Za-z]*c(?:\\s+--)?\\s+${QUOTED}|(\\S+))|(?:^|[\\s;&|(\`])eval\\s+${QUOTED}|([^;&|\\n]+))`,
  "g",
);

/** Backslash-newline continuations removed and runs of blanks collapsed, so spacing cannot dodge a pattern. */
const squash = (text: string) => text.replace(/\\\r?\n/g, "").replace(/[ \t\v\f]+/g, " ");

/** Command units: the command cut at `;`, `&`, `|`, newlines, backticks and parentheses (quotes are not tracked, so a separator inside quotes also cuts, which only makes deny rules stricter), plus the payloads of `sh -c` and `eval`. */
export function commandUnits(command: string, depth = 0): string[] {
  const text = squash(command);
  // Redirections like 2>&1 and &>file are not separators.
  const units = text.replace(/[0-9]*[<>]&[0-9-]*/g, " ").replace(/&>>?/g, ">").split(/\$\(|[;&|\n\r`()]/).map((u) => u.trim()).filter(Boolean);
  if (depth < MAX_DEPTH) {
    for (const match of text.matchAll(SHELL_C)) {
      const payload = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6];
      if (payload) units.push(...commandUnits(payload.replace(/\\(["\\$`])/g, "$1"), depth + 1));
    }
  }
  return [...new Set(units)];
}

/** The program name unquoted and without its directory. */
function bareHead(text: string): string {
  const match = /^(\S+)([\s\S]*)$/.exec(text);
  return match ? match[1]!.replace(/['"\\]/g, "").replace(/^.*\//, "") + match[2] : text;
}

/** Forms a deny rule is tried against: the unit as written plus what a shell would actually run, i.e. without leading keywords, assignments and wrappers like `env`, and with the program name unquoted and without its directory. */
function denyForms(unit: string): string[] {
  const forms = [unit];
  let rest = unit;
  // One step at a time, so `then sudo ls` is also tried as `sudo ls`, not only as `ls`.
  const steps = [(t: string) => t.replace(KEYWORDS, ""), (t: string) => t.replace(ASSIGNMENT, ""), (t: string) => t.replace(WRAPPER, ""), bareHead];
  for (let guard = 0; guard < 6; guard++) {
    let changed = false;
    for (const step of steps) {
      const next = step(rest).trimStart();
      if (next !== rest) {
        rest = next;
        forms.push(rest);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return [...new Set(forms)];
}

/** Forms an allow rule is tried against: only the unit as written, with shell keywords removed. Directories, assignments and wrappers are never looked through, so none of them can borrow an allowed name. */
const allowForms = (unit: string) => [unit, unit.replace(KEYWORDS, "")];

const ellipsis = (text: string) => (text.length > 60 ? `${text.slice(0, 57)}...` : text);

// ---------------------------------------------------------------------------

/** Compiles the `tools` section of a policy; null without one. */
export function compileToolRules(policy: ManagedPolicy | null | undefined): ToolRules | null {
  const tools = policy?.tools;
  if (!tools) return null;
  const toolDeny = compile(tools.deny);
  const toolAllow = compile(tools.allow);
  const bashDeny = compile(tools.bash?.deny);
  const bashAllow = compile(tools.bash?.allow);
  const skillDeny = compile(tools.skills?.deny);
  const skillAllow = compile(tools.skills?.allow);

  /** `tool` null is a resource call on the server. */
  const mcpCheck = (server: string, tool: string | null, label: string): Denial | null => {
    const hit = mcpHit(tools.mcp?.deny, server, tool, true);
    if (hit !== undefined) return denial(`tools.mcp.deny "${hit}"`);
    if (tools.mcp?.allow && mcpHit(tools.mcp.allow, server, tool, false) === undefined) return denial(`tools.mcp.allow (${label} is not listed)`);
    return null;
  };

  return {
    checkTool(toolName) {
      const hit = toolDeny(toolName);
      if (hit !== undefined) return denial(`tools.deny "${hit}"`);
      if (tools.allow && !INTERNAL_TOOLS.includes(toolName) && toolAllow(toolName) === undefined) return denial(`tools.allow (${toolName} is not listed)`);
      return null;
    },

    checkBash(command) {
      if (command.length > MAX_COMMAND_CHARS) return denial(`tools.bash (a command over ${MAX_COMMAND_CHARS} characters cannot be checked)`);
      const text = squash(command).trim();
      const units = commandUnits(text);
      const hit = bashDeny(text, ...units.flatMap(denyForms));
      if (hit !== undefined) return denial(`tools.bash.deny "${hit}"`);
      if (tools.bash?.allow) {
        const stray = units.find((unit) => !NOT_A_COMMAND.test(unit) && bashAllow(...allowForms(unit)) === undefined);
        if (stray !== undefined) return denial(`tools.bash.allow (no pattern allows "${ellipsis(stray)}")`);
      }
      return null;
    },

    checkMcp(toolName, input) {
      if (MCP_RESOURCE_TOOLS.includes(toolName)) {
        if (!tools.mcp?.deny?.length && !tools.mcp?.allow) return null;
        const server = (input as { server?: unknown } | null | undefined)?.server;
        // Without a server these tools list resources of every server, including the ones the policy excludes.
        if (typeof server !== "string" || !server) return denial(`tools.mcp (${toolName} must name a server)`);
        return mcpCheck(normaliseMcp(server), null, `server ${server}`);
      }
      if (!toolName.startsWith("mcp__")) return null;
      const parsed = parseMcpName(toolName);
      // A name that does not split cannot be matched to a server, so it is treated as one nothing allows.
      return parsed ? mcpCheck(parsed.server, parsed.tool, toolName) : denial(`tools.mcp (${toolName} is not a recognisable MCP tool name)`);
    },

    skillAllowed(name) {
      if (skillDeny(name) !== undefined) return false;
      return !tools.skills?.allow || skillAllow(name) !== undefined;
    },
  };
}

/** True for the tools that run a shell command from `input.command`. */
export const isShellTool = (toolName: string) => SHELL_TOOLS.includes(toolName);
