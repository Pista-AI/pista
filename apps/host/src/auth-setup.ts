import { chmodSync, closeSync, existsSync, fsyncSync, openSync, readFileSync, statSync, writeSync } from "node:fs";
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
  source.key.fill(0); // the store holds its own copy; do not retain the caller's
  try {
    await store.list();
  } catch {
    throw new Error(`auth.enc.json cannot be decrypted with the current key (wrong key or corrupt file). Delete ${encFile} to start over; you will need to sign in to providers again.`);
  }
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
  // importPlain has fsynced the encrypted file and its directory by now. Overwrite the plaintext with zeros before
  // unlinking; best effort only, since SSD wear levelling and copy-on-write filesystems may keep old blocks.
  try {
    const size = statSync(plainFile).size;
    const fd = openSync(plainFile, "r+");
    try {
      writeSync(fd, Buffer.alloc(size));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Unlink below still runs.
  }
  try {
    await rm(plainFile, { force: true });
  } catch (e) {
    log(`[pista-host] auth: could not remove auth.json after migration: ${(e as NodeJS.ErrnoException).code ?? "unknown"}`);
  }
  return { credentials: store, mode: "encrypted" };
}
