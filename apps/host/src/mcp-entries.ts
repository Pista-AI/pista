import type { McpExposure, McpServerConfig } from "@pista/protocol";

// Pure mcp.json entry parsing and validation. Kept apart from mcp-config.ts so importing it does not touch the home directory.

export type Raw = Record<string, unknown>;

/** Names that would reach Object.prototype when used as a key. */
const RESERVED = ["__proto__", "constructor", "prototype"];
export const NAME = /^[A-Za-z0-9_-]+$/;
export const EXPOSURES: readonly string[] = ["direct", "deferred", "codemode", "hidden"];

export const isRecord = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
export const isStrings = (v: unknown): v is Record<string, string> => isRecord(v) && Object.values(v).every((x) => typeof x === "string");

/** An entry of mcp.json as the UI sees it, or undefined for shapes it does not model (they stay in the file). */
export function fromRaw(name: string, raw: unknown): McpServerConfig | undefined {
  if (!isRecord(raw)) return undefined;
  const base = {
    name,
    ...(typeof raw.exposure === "string" && EXPOSURES.includes(raw.exposure) ? { exposure: raw.exposure as McpExposure } : {}),
    ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
    ...(typeof raw.timeout === "number" ? { timeout: raw.timeout } : {}),
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
  };
  if (typeof raw.command === "string") {
    return {
      ...base,
      transport: "stdio",
      command: raw.command,
      ...(Array.isArray(raw.args) ? { args: raw.args.map(String) } : {}),
      ...(isStrings(raw.env) ? { env: raw.env } : {}),
      ...(typeof raw.cwd === "string" ? { cwd: raw.cwd } : {}),
    };
  }
  if (typeof raw.url === "string") return { ...base, transport: "http", url: raw.url, ...(isStrings(raw.headers) ? { headers: raw.headers } : {}) };
  return undefined;
}

/** An error message for the first invalid entry, or undefined. Pi would otherwise drop the entry silently at connect time. */
export function validateServers(servers: unknown): string | undefined {
  if (!Array.isArray(servers)) return "mcpServers must be a list";
  const seen = new Set<string>();
  for (const s of servers as Partial<Record<string, unknown>>[]) {
    const name = typeof s?.name === "string" ? s.name : "";
    if (!NAME.test(name) || RESERVED.includes(name)) return `Invalid MCP server name "${name}": use letters, digits, "_" and "-".`;
    // Pi treats names that differ only in "-" versus "_" as one server.
    const key = name.replace(/-/g, "_");
    if (seen.has(key)) return `MCP server "${name}" duplicates another name ("-" and "_" count as the same).`;
    seen.add(key);
    if (s.transport === "http") {
      if (typeof s.url !== "string" || !/^https?:\/\/\S+$/i.test(s.url)) return `MCP server "${name}": the URL must start with http:// or https://.`;
      if (s.headers !== undefined && !isStrings(s.headers)) return `MCP server "${name}": headers must map names to strings.`;
    } else if (s.transport === "stdio") {
      if (typeof s.command !== "string" || !s.command.trim()) return `MCP server "${name}": a command is required.`;
      if (s.args !== undefined && !(Array.isArray(s.args) && s.args.every((a) => typeof a === "string"))) return `MCP server "${name}": args must be a list of strings.`;
      if (s.env !== undefined && !isStrings(s.env)) return `MCP server "${name}": env must map names to strings.`;
    } else {
      return `MCP server "${name}": transport must be "http" or "stdio".`;
    }
    if (s.exposure !== undefined && !EXPOSURES.includes(s.exposure as string)) return `MCP server "${name}": exposure must be one of ${EXPOSURES.join(", ")}.`;
    if (s.timeout !== undefined && !(typeof s.timeout === "number" && s.timeout > 0)) return `MCP server "${name}": timeout must be a positive number of seconds.`;
  }
  return undefined;
}
