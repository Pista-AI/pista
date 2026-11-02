import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Shapes copied from Pi's dist/core/auth-storage.d.ts (not exported from the package root). */
export type LockResult<T> = { result: T; next?: string };
export interface AuthStorageBackend {
  withLock<T>(fn: (current: string | undefined) => LockResult<T>): T;
  withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>, options?: { signal?: AbortSignal }): Promise<T>;
}
/** Pi's McpOAuthCredentialStore, as far as Pista uses it. */
export interface McpOAuthCredentialStoreLike {
  forServer(name: string, serverUrl: string): unknown;
  tokens(name: string, serverUrl: string): unknown;
  remove(name: string, serverUrl: string): boolean;
}
export type McpOAuthCredentialStoreCtor = new (backend: AuthStorageBackend, lockDir: string) => McpOAuthCredentialStoreLike;

/**
 * Pi does not export McpOAuthCredentialStore, which is the only way to give the MCP extension a different token
 * store. This imports it from Pi's dist by path, relative to the resolved package entry, and checks its shape.
 * If a Pi upgrade moves or reshapes it this throws, and encrypted mode must then refuse to start rather than
 * fall back to plain tokens.
 */
export async function loadMcpOAuthCredentialStore(): Promise<McpOAuthCredentialStoreCtor> {
  const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
  const target = new URL("./extensions/mcp/oauth.js", entry);
  let version = "unknown";
  try {
    version = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", entry)), "utf-8")).version ?? version;
  } catch {
    // The version only makes the error message better.
  }
  const fail = (): never => {
    throw new Error(`Pi ${version} no longer exposes McpOAuthCredentialStore at ${target.pathname}; MCP tokens cannot be encrypted`);
  };
  let mod: Record<string, unknown>;
  try {
    mod = (await import(target.href)) as Record<string, unknown>;
  } catch {
    return fail();
  }
  const ctor = mod.McpOAuthCredentialStore;
  if (typeof ctor !== "function" || ctor.name !== "McpOAuthCredentialStore") return fail();
  const proto = (ctor as { prototype: Record<string, unknown> }).prototype;
  for (const m of ["forServer", "tokens", "remove"]) if (typeof proto[m] !== "function") return fail();
  return ctor as McpOAuthCredentialStoreCtor;
}
