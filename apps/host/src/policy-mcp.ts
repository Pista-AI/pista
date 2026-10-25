import { isDeepStrictEqual } from "node:util";
import type { ManagedPolicy } from "@pista/protocol";
import { mcpKey } from "./policy-access.ts";

export interface McpReconcile {
  /** The `mcpServers` map to write. */
  servers: Record<string, unknown>;
  changed: boolean;
  /** Names of the policy's servers now in the file; persist them so a later policy that drops one removes it. */
  managed: string[];
}

/**
 * Brings the `mcpServers` of mcp.json in line with the policy: servers the previous run installed are removed, blocked names are removed,
 * and the policy's servers are written (replacing a same-name user entry in place). Pure: nothing is read or written here.
 */
export function reconcileMcp(current: Record<string, unknown>, mcp: ManagedPolicy["mcp"], previous: readonly string[]): McpReconcile {
  const blocked = new Set((mcp?.blockedServers ?? []).map(mcpKey));
  const wanted = Object.entries(mcp?.servers ?? {}).filter(([name]) => !blocked.has(mcpKey(name)));
  const wantedByKey = new Map(wanted.map(([name, entry]) => [mcpKey(name), [name, entry] as const]));
  const gone = new Set([...previous.map(mcpKey), ...blocked]);
  const servers: Record<string, unknown> = Object.create(null);
  const placed = new Set<string>();
  for (const [name, entry] of Object.entries(current)) {
    const key = mcpKey(name);
    const policyEntry = wantedByKey.get(key);
    if (policyEntry) {
      if (placed.has(key)) continue;
      placed.add(key);
      servers[policyEntry[0]] = structuredClone(policyEntry[1]);
    } else if (!gone.has(key)) {
      servers[name] = entry;
    }
  }
  for (const [name, entry] of wanted) if (!placed.has(mcpKey(name))) servers[name] = structuredClone(entry);
  return { servers, changed: !sameServers(servers, current), managed: wanted.map(([name]) => name) };
}

/** Same names in the same order with structurally equal entries; key order inside an entry does not count. */
function sameServers(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return isDeepStrictEqual(Object.keys(a), Object.keys(b)) && Object.keys(a).every((name) => isDeepStrictEqual(a[name], b[name]));
}

/** The startup log line, or null without an `mcp` section. */
export function describeMcp(mcp: ManagedPolicy["mcp"]): string | null {
  if (!mcp) return null;
  return `[pista-host] managed mcp: ${Object.keys(mcp.servers ?? {}).length} servers, ${mcp.blockedServers?.length ?? 0} blocked, user servers ${mcp.allowUserServers === false ? "disabled" : "allowed"}`;
}
