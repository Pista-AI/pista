import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import type { AuthKeySource } from "./auth-key.ts";
import { createEncryptedCredentialStore, describeDecryptFailure, dropBackupIfEncryptedOk, moveToBackup, readEncryptedFile } from "./auth-store.ts";
import { setupMcpAuth } from "./mcp-auth-store.ts";
import type { McpOAuthCredentialStoreLike } from "./pi-mcp-oauth.ts";

/**
 * Chooses the credential stores. Plain mode returns none, so Pi uses its own auth.json and mcp-auth.json. The MCP
 * store is set up first because the provider setup zeroes the caller's key buffer.
 */
export async function setupCredentials(
  source: AuthKeySource,
  agentDir: string,
  log: (line: string) => void,
): Promise<{ credentials?: CredentialStore; mcpCredentials?: McpOAuthCredentialStoreLike; mode: "encrypted" | "plain" }> {
  if (source.kind === "key") {
    // Check both files before either setup touches anything, so one start reports every failure.
    const checks: [string, string, string][] = [
      ["mcp-auth.enc.json", join(agentDir, "mcp-auth.enc.json"), join(agentDir, "mcp-auth.json")],
      ["auth.enc.json", join(agentDir, "auth.enc.json"), join(agentDir, "auth.json")],
    ];
    const failures: string[] = [];
    for (const [name, file, plain] of checks) {
      try {
        readEncryptedFile(file, source.key);
      } catch (e) {
        failures.push(describeDecryptFailure(name, file, e, plain));
      }
    }
    if (failures.length) throw new Error(failures.join("\n"));
  }
  const mcp = await setupMcpAuth(source, agentDir, log);
  const res = await setupProviderCredentials(source, agentDir, log);
  return { ...res, ...(mcp.credentials ? { mcpCredentials: mcp.credentials } : {}) };
}

async function setupProviderCredentials(
  source: AuthKeySource,
  agentDir: string,
  log: (line: string) => void,
): Promise<{ credentials?: CredentialStore; mode: "encrypted" | "plain" }> {
  const encFile = join(agentDir, "auth.enc.json");
  const plainFile = join(agentDir, "auth.json");
  if (source.kind === "plain") {
    if (existsSync(encFile)) throw new Error("auth.enc.json exists; refusing to start in plain mode (unset PISTA_AUTH_PLAIN or supply the key)");
    log("[pista-host] auth: PISTA_AUTH_PLAIN=1, provider credentials stay in plain auth.json");
    return { mode: "plain" };
  }
  const store = createEncryptedCredentialStore({ file: encFile, key: source.key });
  source.key.fill(0); // the store holds its own copy; do not retain the caller's
  try {
    await store.list();
  } catch (e) {
    throw new Error(describeDecryptFailure("auth.enc.json", encFile, e, plainFile), { cause: e });
  }
  dropBackupIfEncryptedOk(encFile, plainFile, log);
  if (!existsSync(plainFile)) return { credentials: store, mode: "encrypted" };

  const keepPlain = (why: string): { credentials: CredentialStore; mode: "encrypted" } => {
    try {
      chmodSync(plainFile, 0o600);
    } catch {
      // Best effort; the warning below still names the path.
    }
    log(`[pista-host] auth: WARNING plaintext credentials remain at ${plainFile} (${why}); the file was kept with mode 0600`);
    return { credentials: store, mode: "encrypted" };
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(plainFile, "utf-8"));
  } catch {
    return keepPlain("it could not be parsed");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return keepPlain("it is not a credential map");
  const entries = parsed as Record<string, Credential>;
  const imported: string[] = [];
  const skipped: string[] = [];
  const invalid: string[] = [];
  for (const [id, entry] of Object.entries(entries)) {
    try {
      const r = await store.importPlain({ [id]: entry });
      imported.push(...r.imported);
      skipped.push(...r.skipped);
    } catch {
      invalid.push(id);
    }
  }
  if (imported.length || skipped.length) {
    log(`[pista-host] auth: migrated ${imported.length} provider credential(s) from auth.json into auth.enc.json${imported.length ? ` (${imported.join(", ")})` : ""}${skipped.length ? `; kept existing encrypted entries for ${skipped.join(", ")}` : ""}`);
  }
  if (invalid.length) return keepPlain(`${invalid.length} entr${invalid.length === 1 ? "y was" : "ies were"} not migrated`);
  // importPlain has fsynced the encrypted file and its directory by now. Keep the plaintext as a 0600 backup; the next
  // start removes it once the encrypted file has decrypted with the current key.
  try {
    const bak = moveToBackup(plainFile);
    log(`[pista-host] auth: kept the migrated plaintext as ${bak} (mode 0600); it is removed on the next start once auth.enc.json decrypts`);
  } catch (e) {
    return keepPlain(`could not move it to a backup: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  }
  return { credentials: store, mode: "encrypted" };
}
