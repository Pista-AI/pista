import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, rmdirSync, statSync, writeSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { AuthKeySource } from "./auth-key.ts";
import { fsyncDir, readEncryptedFile, writeEncryptedFile } from "./auth-store.ts";
import { type AuthStorageBackend, loadMcpOAuthCredentialStore, type LockResult, type McpOAuthCredentialStoreCtor, type McpOAuthCredentialStoreLike } from "./pi-mcp-oauth.ts";

const STALE_MS = 30_000;

/**
 * Pi's MCP token store reads and writes through an AuthStorageBackend. This one keeps the content in an AES-256-GCM
 * file instead of plain JSON. It takes the same kind of lock as Pi's file backend (an exclusive lock directory next
 * to the file, stale after 30 s), so two processes on one PISTA_HOME do not overwrite each other's tokens.
 */
export function createEncryptedAuthStorageBackend({ file, key: keyArg }: { file: string; key: Buffer }): AuthStorageBackend {
  if (!Buffer.isBuffer(keyArg) || keyArg.length !== 32) throw new Error("mcp auth store: key must be 32 bytes");
  const key = Buffer.from(keyArg);
  const lock = `${file}.lock`;
  const tryLock = (): boolean => {
    mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
    try {
      mkdirSync(lock);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_MS) rmdirSync(lock); // a crashed holder; the next attempt takes over
      } catch {
        // Released in the meantime.
      }
      return false;
    }
  };
  const release = (): void => {
    try {
      rmdirSync(lock);
    } catch {
      // Already gone.
    }
  };
  const sleepSync = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const current = (): string | undefined => readEncryptedFile(file, key);

  return {
    withLock<T>(fn: (current: string | undefined) => LockResult<T>): T {
      let n = 0;
      while (!tryLock()) if (++n >= 50) throw new Error(`mcp auth store: ${file} is locked by another process`);
      else sleepSync(20);
      try {
        const { result, next } = fn(current());
        if (next !== undefined) writeEncryptedFile(file, key, next);
        return result;
      } finally {
        release();
      }
    },
    async withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>, options?: { signal?: AbortSignal }): Promise<T> {
      const deadline = Date.now() + STALE_MS;
      for (let retry = 0; ; retry++) {
        options?.signal?.throwIfAborted();
        if (tryLock()) break;
        if (Date.now() > deadline) throw new Error(`mcp auth store: ${file} is locked by another process`);
        await new Promise((r) => setTimeout(r, Math.min(10 * 2 ** retry, 1000) * (1 + Math.random())));
      }
      try {
        const { result, next } = await fn(current());
        options?.signal?.throwIfAborted();
        if (next !== undefined) writeEncryptedFile(file, key, next);
        return result;
      } finally {
        release();
      }
    },
  };
}

/**
 * Chooses the MCP token store. Plain mode returns none (Pi keeps `mcp-auth.json`). Encrypted mode migrates a plain
 * `mcp-auth.json` into `mcp-auth.enc.json` and returns a Pi store on top of it. The key is copied; the caller still zeroes its own.
 */
export async function setupMcpAuth(
  source: AuthKeySource,
  agentDir: string,
  log: (line: string) => void,
  load: () => Promise<McpOAuthCredentialStoreCtor> = loadMcpOAuthCredentialStore,
): Promise<{ credentials?: McpOAuthCredentialStoreLike }> {
  const encFile = join(agentDir, "mcp-auth.enc.json");
  const plainFile = join(agentDir, "mcp-auth.json");
  if (source.kind === "plain") {
    if (existsSync(encFile)) throw new Error("mcp-auth.enc.json exists; refusing to start in plain mode (unset PISTA_AUTH_PLAIN or supply the key)");
    return {};
  }
  const Store = await load();
  const key = Buffer.from(source.key);
  const backend = createEncryptedAuthStorageBackend({ file: encFile, key });
  try {
    readEncryptedFile(encFile, key); // read-only check, no lock, so a read-only directory still starts
  } catch {
    key.fill(0);
    throw new Error(`mcp-auth.enc.json cannot be decrypted with the current key (wrong key or corrupt file). Delete ${encFile} to start over; you will need to sign in to MCP servers again.`);
  }
  key.fill(0); // the backend holds its own copy
  const result = { credentials: new Store(backend, agentDir) };
  if (!existsSync(plainFile)) return result;

  const keepPlain = (why: string): typeof result => {
    try {
      chmodSync(plainFile, 0o600);
    } catch {
      // Best effort; the warning below still names the path.
    }
    log(`[pista-host] mcp auth: WARNING plaintext MCP tokens remain at ${plainFile} (${why}); the file was kept with mode 0600`);
    return result;
  };
  let incoming: unknown;
  try {
    incoming = JSON.parse(readFileSync(plainFile, "utf-8"));
  } catch {
    return keepPlain("it could not be parsed");
  }
  if (typeof incoming !== "object" || incoming === null || Array.isArray(incoming)) return keepPlain("it is not a server map");
  const imported: string[] = [];
  const skipped: string[] = [];
  try {
    backend.withLock((cur) => {
      const existing = cur === undefined ? {} : (JSON.parse(cur) as Record<string, unknown>);
      for (const [name, entry] of Object.entries(incoming as Record<string, unknown>)) {
        if (name in existing) skipped.push(name);
        else {
          existing[name] = entry;
          imported.push(name);
        }
      }
      return imported.length ? { result: undefined, next: JSON.stringify(existing, null, 2) } : { result: undefined };
    });
  } catch {
    return keepPlain("it could not be merged into the encrypted file");
  }
  log(`[pista-host] mcp auth: migrated ${imported.length} MCP server sign-in(s) from mcp-auth.json into mcp-auth.enc.json${skipped.length ? `; kept existing encrypted entries for ${skipped.length}` : ""}`);
  // The encrypted copy is fsynced by now. Zero the plaintext before unlinking; best effort on SSDs and copy-on-write filesystems.
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
    fsyncDir(agentDir);
  } catch (e) {
    log(`[pista-host] mcp auth: could not remove mcp-auth.json after migration: ${(e as NodeJS.ErrnoException).code ?? "unknown"}`);
  }
  return result;
}
