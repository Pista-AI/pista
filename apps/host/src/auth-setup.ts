import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import type { AuthKeySource } from "./auth-key.ts";
import { createEncryptedCredentialStore } from "./auth-store.ts";

/** Chooses the credential store for ModelRuntime. Plain mode returns no store, so Pi uses its own auth.json. */
export async function setupCredentials(
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
  try {
    await store.list();
  } catch {
    throw new Error(`auth.enc.json cannot be decrypted with the current key (wrong key or corrupt file). Delete ${encFile} to start over; you will need to sign in to providers again.`);
  }
  if (existsSync(plainFile)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(plainFile, "utf-8"));
    } catch {
      log("[pista-host] auth: auth.json could not be parsed; leaving it in place and not migrating");
      return { credentials: store, mode: "encrypted" };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      log("[pista-host] auth: auth.json is not a credential map; leaving it in place and not migrating");
      return { credentials: store, mode: "encrypted" };
    }
    const entries = parsed as Record<string, Credential>;
    if (Object.keys(entries).length > 0) {
      let result: { imported: string[]; skipped: string[] };
      try {
        result = await store.importPlain(entries);
      } catch {
        log("[pista-host] auth: auth.json has unsupported entries; not migrated (file kept)");
        return { credentials: store, mode: "encrypted" };
      }
      const { imported, skipped } = result;
      log(`[pista-host] auth: migrated ${imported.length} provider credential(s) from auth.json into auth.enc.json${imported.length ? ` (${imported.join(", ")})` : ""}${skipped.length ? `; kept existing encrypted entries for ${skipped.join(", ")}` : ""}`);
    }
    try {
      await rm(plainFile, { force: true });
    } catch (e) {
      log(`[pista-host] auth: could not remove auth.json after migration: ${(e as NodeJS.ErrnoException).code ?? "unknown"}`);
    }
  }
  return { credentials: store, mode: "encrypted" };
}
