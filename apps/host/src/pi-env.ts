// Side-effect module: import it before anything from Pi. Pi's MCP extension finds mcp.json, mcp-auth.json and
// mcp.log through getAgentDir(), which reads PI_CODING_AGENT_DIR, so the variable must be set before Pi code runs.
// pi-memory reads PI_MEMORY_DIR the same way, so it is set here as well.
import { chmodSync, cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Client-owned state; everything per-user lives under it (see AGENTS.md, server-readiness rules). */
export const CLIENT_DIR = process.env.PISTA_HOME ?? join(homedir(), ".pista");

const defaulted = !process.env.PI_CODING_AGENT_DIR;
if (defaulted) process.env.PI_CODING_AGENT_DIR = join(CLIENT_DIR, "pi");

/** Pi's agent dir (sessions, auth, mcp.json, ...): `$PISTA_HOME/pi` unless `PI_CODING_AGENT_DIR` says otherwise. Same resolution as Pi's getAgentDir(). */
export function piAgentDir(): string {
  return (process.env.PI_CODING_AGENT_DIR ?? join(CLIENT_DIR, "pi")).replace(/^~(?=$|\/)/, homedir());
}

// Agent memory (MEMORY.md, daily logs) follows the agent dir unless PI_MEMORY_DIR says otherwise.
const memoryDefaulted = !process.env.PI_MEMORY_DIR;
if (memoryDefaulted) process.env.PI_MEMORY_DIR = join(piAgentDir(), "memory");

/** pi-memory's directory: `$PISTA_HOME/pi/memory` unless `PI_MEMORY_DIR` says otherwise. Same resolution as pi-memory. */
export function piMemoryDir(): string {
  return (process.env.PI_MEMORY_DIR ?? join(piAgentDir(), "memory")).replace(/^~(?=$|\/)/, homedir());
}

/** What the one-time migration copies from the shared Pi dir: sessions, sign-ins and MCP state. Copied, never moved. */
const MIGRATED = ["sessions", "auth.json", "settings.json", "models-store.json", "mcp.json", "mcp-auth.json"];

/** Copies Pista's Pi state from `from` (the Pi CLI's ~/.pi/agent) into the fresh `to`. Returns what was copied. */
export function migratePiState(from: string, to: string): string[] {
  const copied = MIGRATED.filter((name) => existsSync(join(from, name)));
  for (const name of copied) cpSync(join(from, name), join(to, name), { recursive: true, errorOnExist: false });
  writeFileSync(join(to, ".migrated-from"), `${from}\n`, { mode: 0o600 });
  return copied;
}

/** Copies pi-memory's directory from `from` to `to`, but only when `from` exists and `to` does not. Never overwrites. Returns whether it copied. */
export function migratePiMemory(from: string, to: string): boolean {
  if (existsSync(to) || !existsSync(from)) return false;
  cpSync(from, to, { recursive: true, errorOnExist: false });
  return true;
}

// Only the default location migrates, and only once: an explicit PI_CODING_AGENT_DIR is the user's choice.
const legacy = join(homedir(), ".pi", "agent");
const dir = piAgentDir();
const fresh = !existsSync(dir);
mkdirSync(dir, { recursive: true, mode: 0o700 });
chmodSync(dir, 0o700);
if (defaulted && fresh && existsSync(legacy)) {
  try {
    const copied = migratePiState(legacy, dir);
    console.log(`[pista-host] copied Pi state (${copied.join(", ") || "nothing"}) from ${legacy} to ${dir}`);
  } catch (error) {
    console.error(`[pista-host] could not copy Pi state from ${legacy}: ${(error as Error).message}`);
  }
}

// Memory is migrated separately from the state above: existing installs already have the agent dir, so a
// fresh-dir check would never copy their memory. Only the default locations migrate: an explicit
// PI_CODING_AGENT_DIR or PI_MEMORY_DIR is the user's choice and is not migrated.
if (defaulted && memoryDefaulted) {
  const from = join(legacy, "memory");
  try {
    const to = piMemoryDir();
    if (migratePiMemory(from, to)) console.log(`[pista-host] copied Pi memory from ${from} to ${to}`);
  } catch (error) {
    console.error(`[pista-host] could not copy Pi memory from ${from}: ${(error as Error).message}`);
  }
}
