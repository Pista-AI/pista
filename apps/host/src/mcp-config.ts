import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { McpExposure, McpServerConfig } from "@pista/protocol";
import { fromRaw, isRecord, type Raw, validateServers } from "./mcp-entries.ts";
import { piAgentDir } from "./pi-env.ts";
import { checkMcpChange, type McpRules } from "./policy-access.ts";

// ---------------------------------------------------------------------------
// $PISTA_HOME/pi/mcp.json: the standard `mcpServers` format, read by Pi's built-in MCP extension.
// ---------------------------------------------------------------------------

export { fromRaw, validateServers };

/** Keys the protocol type models; anything else in an existing entry (type, oauth, auth, toolExposure) is kept on write. */
const MODELLED = ["url", "headers", "command", "args", "env", "cwd", "exposure", "enabled", "timeout", "description"];

/** The mcp.json entry for a server. `type` is left out: Pi infers it from `command` or `url`. */
export function toRaw(server: McpServerConfig): Raw {
  const out: Raw =
    server.transport === "stdio"
      ? { command: server.command, ...(server.args?.length ? { args: server.args } : {}), ...(server.env && Object.keys(server.env).length ? { env: server.env } : {}), ...(server.cwd ? { cwd: server.cwd } : {}) }
      : { url: server.url, ...(server.headers && Object.keys(server.headers).length ? { headers: server.headers } : {}) };
  if (server.exposure) out.exposure = server.exposure;
  if (server.enabled !== undefined) out.enabled = server.enabled;
  if (server.timeout !== undefined) out.timeout = server.timeout;
  if (server.description) out.description = server.description;
  return out;
}

/** A server entry as config.json stored it before mcp.json became the source of truth. */
export interface LegacyServer {
  name?: string;
  url?: string;
  tokenEnvVar?: string;
  token?: string;
  exposure?: McpExposure;
  description?: string;
}

/** `tokenEnvVar` becomes `Authorization: Bearer ${VAR}` (Pi expands it), a literal token stays a literal header. */
export function convertLegacy(old: LegacyServer): McpServerConfig | undefined {
  if (!old.name || !old.url) return undefined;
  const bearer = old.tokenEnvVar ? `Bearer \${${old.tokenEnvVar}}` : old.token ? `Bearer ${old.token}` : undefined;
  return {
    name: old.name,
    transport: "http",
    url: old.url,
    ...(bearer ? { headers: { Authorization: bearer } } : {}),
    ...(old.exposure ? { exposure: old.exposure } : {}),
    ...(old.description ? { description: old.description } : {}),
  };
}

/** Reads and writes the `mcpServers` of one mcp.json, keeping everything the UI does not model. */
export class McpFile {
  private cache?: { mtimeMs: number; servers: McpServerConfig[] };
  /** Set from the managed policy: `set` then refuses changes to managed servers, blocked names and (when users may not) additions. */
  rules?: McpRules;

  constructor(private path: string = join(piAgentDir(), "mcp.json")) {}

  /** The parsed file. A missing file is empty; `strict` throws on unreadable JSON so a write cannot clobber a half-edited file. */
  private doc(strict = false): Raw {
    if (!existsSync(this.path)) return {};
    try {
      const doc = JSON.parse(readFileSync(this.path, "utf8"));
      if (isRecord(doc)) return doc;
      if (strict) throw new Error("not a JSON object");
    } catch (error) {
      if (strict) throw new Error(`${this.path} is not valid JSON (${(error as Error).message}); fix or remove it before changing MCP servers here.`);
    }
    return {};
  }

  /** The servers in the file; re-read when it changed on disk (the user may edit it by hand). */
  list(): McpServerConfig[] {
    const mtimeMs = existsSync(this.path) ? statSync(this.path).mtimeMs : -1;
    if (this.cache?.mtimeMs !== mtimeMs) {
      const raw = this.doc().mcpServers;
      const servers = isRecord(raw) ? Object.entries(raw).flatMap(([name, entry]) => fromRaw(name, entry) ?? []) : [];
      this.cache = { mtimeMs, servers };
    }
    return this.cache.servers;
  }

  /** The raw `mcpServers` map, entries the UI cannot model included. Throws when the file is not valid JSON. */
  entries(): Raw {
    const raw = this.doc(true).mcpServers;
    return isRecord(raw) ? raw : {};
  }

  /** Replaces the raw `mcpServers` map, keeping other top-level keys. Used by the policy reconciliation; `set` is the checked path. */
  replaceEntries(next: Raw): void {
    this.write(this.doc(true), next);
  }

  /** Replaces the file's servers with `servers`. Entries the UI does not model (OAuth settings, per-tool exposure) survive on servers that stay. Throws when the policy forbids the change. */
  set(servers: McpServerConfig[]): void {
    const doc = this.doc(true);
    const existing = isRecord(doc.mcpServers) ? doc.mcpServers : {};
    const denied = checkMcpChange(this.rules, Object.entries(existing).flatMap(([name, entry]) => fromRaw(name, entry) ?? []), servers);
    if (denied) throw new Error(denied);
    const next: Raw = {};
    const kept = Object.entries(existing).filter(([name, entry]) => !fromRaw(name, entry));
    for (const [name, entry] of kept) next[name] = entry; // entries the UI cannot represent stay untouched
    for (const server of servers) {
      const old = existing[server.name];
      const sameKind = isRecord(old) && fromRaw(server.name, old)?.transport === server.transport;
      const extras = sameKind ? Object.fromEntries(Object.entries(old as Raw).filter(([k]) => !MODELLED.includes(k))) : {};
      next[server.name] = { ...extras, ...toRaw(server) };
    }
    this.write(doc, next);
  }

  private write(doc: Raw, mcpServers: Raw): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    // Write beside the file and rename, so Pi never reads a half-written mcp.json.
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...doc, mcpServers }, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, this.path);
    this.cache = undefined;
  }
}
