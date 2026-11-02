import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { AuthKeySource } from "./auth-key.ts";
import { fsyncDir, readEncryptedFile, writeEncryptedFile } from "./auth-store.ts";
import { type AuthStorageBackend, loadMcpOAuthCredentialStore, type LockResult, type McpOAuthCredentialStoreCtor, type McpOAuthCredentialStoreLike } from "./pi-mcp-oauth.ts";

/** Pi holds the lock for milliseconds, so a lock older than this belongs to a crashed process. */
export const LOCK_STALE_MS = 5_000;
const LOCK_WAIT_MS = 10_000;
const OWNER = "owner";

/**
 * Takes an exclusive lock directory and returns the owner token, or undefined when someone else holds it. The owner
 * file inside holds a random token and the pid. A stale lock is renamed away first (so only one stealer wins), then
 * its mtime is checked again before it is deleted.
 */
export function tryAcquireLock(lock: string, staleMs = LOCK_STALE_MS): string | undefined {
  mkdirSync(join(lock, ".."), { recursive: true, mode: 0o700 });
  try {
    mkdirSync(lock);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // Windows reports a lock that is being removed as EPERM/EBUSY/EACCES; elsewhere only EEXIST means "held".
    if (code !== "EEXIST" && code !== "EBUSY" && !(process.platform === "win32" && (code === "EPERM" || code === "EACCES"))) throw e;
    try {
      if (Date.now() - statSync(lock).mtimeMs > staleMs) {
        const aside = `${lock}.stale.${randomUUID()}`;
        renameSync(lock, aside);
        if (Date.now() - statSync(aside).mtimeMs > staleMs) rmSync(aside, { recursive: true, force: true });
        else renameSync(aside, lock); // it was fresh after all: put it back
      }
    } catch {
      // Released or stolen in the meantime.
    }
    return undefined;
  }
  const token = randomUUID();
  try {
    writeFileSync(join(lock, OWNER), JSON.stringify({ token, pid: process.pid }), { mode: 0o600 });
  } catch (e) {
    rmSync(lock, { recursive: true, force: true });
    throw e;
  }
  return token;
}

/** Removes the lock only if `token` still owns it. Returns false when it did not (nothing is touched). */
export function releaseLock(lock: string, token: string, log: (line: string) => void = console.warn): boolean {
  try {
    const owner = JSON.parse(readFileSync(join(lock, OWNER), "utf-8")) as { token?: unknown };
    if (owner.token !== token) return false;
  } catch {
    return false; // gone, or stolen and replaced
  }
  try {
    rmSync(lock, { recursive: true, force: true });
    return true;
  } catch (e) {
    log(`[pista-host] mcp auth: could not remove lock ${lock}: ${(e as NodeJS.ErrnoException).code ?? "unknown"}`);
    return false;
  }
}

const sleepSync = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const backoff = (retry: number): number => Math.round(Math.min(10 * 2 ** retry, 500) * (1 + Math.random() / 2));

/**
 * Pi's MCP token store reads and writes through an AuthStorageBackend. This one keeps the content in an AES-256-GCM
 * file instead of plain JSON, under an exclusive lock directory next to it (see `tryAcquireLock`), so two processes
 * on one PISTA_HOME do not overwrite each other's tokens.
 */
export function createEncryptedAuthStorageBackend({ file, key: keyArg }: { file: string; key: Buffer }): AuthStorageBackend {
  if (!Buffer.isBuffer(keyArg) || keyArg.length !== 32) throw new Error("mcp auth store: key must be 32 bytes");
  const key = Buffer.from(keyArg);
  const lock = `${file}.lock`;
  const busy = (): Error => new Error(`mcp auth store: ${file} is locked by another process`);
  const current = (): string | undefined => readEncryptedFile(file, key);

  return {
    withLock<T>(fn: (current: string | undefined) => LockResult<T>): T {
      const deadline = Date.now() + LOCK_WAIT_MS;
      let token: string | undefined;
      for (let retry = 0; !(token = tryAcquireLock(lock)); retry++) {
        if (Date.now() > deadline) throw busy();
        sleepSync(backoff(retry));
      }
      try {
        const { result, next } = fn(current());
        if (next !== undefined) writeEncryptedFile(file, key, next);
        return result;
      } finally {
        releaseLock(lock, token);
      }
    },
    async withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>, options?: { signal?: AbortSignal }): Promise<T> {
      const deadline = Date.now() + LOCK_WAIT_MS;
      let token: string | undefined;
      for (let retry = 0; !(token = tryAcquireLock(lock)); retry++) {
        options?.signal?.throwIfAborted();
        if (Date.now() > deadline) throw busy();
        await new Promise((r) => setTimeout(r, backoff(retry)));
      }
      try {
        const { result, next } = await fn(current());
        options?.signal?.throwIfAborted();
        if (next !== undefined) writeEncryptedFile(file, key, next);
        return result;
      } finally {
        releaseLock(lock, token);
      }
    },
  };
}

type Outcome = "migrated" | "kept-skipped" | "gone";

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
  } catch (e) {
    key.fill(0);
    if (e instanceof Error && /cannot decrypt/.test(e.message)) {
      throw new Error(`mcp-auth.enc.json cannot be decrypted with the current key (wrong key or corrupt file). Delete ${encFile} to start over; you will need to sign in to MCP servers again.`, { cause: e });
    }
    throw new Error(`mcp-auth.enc.json cannot be read: ${e instanceof Error ? e.message : "unknown error"}`, { cause: e });
  }
  const result = { credentials: new Store(backend, agentDir) };

  try {
    const keepPlain = (why: string, chmod = true): typeof result => {
      if (chmod) {
        try {
          chmodSync(plainFile, 0o600);
        } catch {
          // Best effort; the warning below still names the path.
        }
      }
      log(`[pista-host] mcp auth: WARNING plaintext MCP tokens remain at ${plainFile} (${why})${chmod ? "; the file was kept with mode 0600" : ""}`);
      return result;
    };
    let st;
    try {
      st = lstatSync(plainFile);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return result;
      return keepPlain("it could not be inspected", false);
    }
    if (st.isSymbolicLink() || !st.isFile()) return keepPlain("it is not a regular file", false);

    const imported: string[] = [];
    const skipped: string[] = [];
    let outcome: Outcome | { keep: string };
    try {
      // One lock around read, merge, write and unlink, so another process cannot write between them.
      outcome = backend.withLock((cur): LockResult<Outcome | { keep: string }> => {
        let text: string;
        try {
          text = readFileSync(plainFile, "utf-8");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") return { result: "gone" }; // another process migrated it
          return { result: { keep: "it could not be read" } };
        }
        let incoming: unknown;
        try {
          incoming = JSON.parse(text);
        } catch {
          return { result: { keep: "it could not be parsed" } };
        }
        if (typeof incoming !== "object" || incoming === null || Array.isArray(incoming)) return { result: { keep: "it is not a server map" } };
        const existing: Record<string, unknown> = cur === undefined ? {} : (JSON.parse(cur) as Record<string, unknown>);
        const merged: Record<string, unknown> = Object.create(null);
        for (const [name, entry] of Object.entries(existing)) merged[name] = entry;
        for (const [name, entry] of Object.entries(incoming as Record<string, unknown>)) {
          if (Object.hasOwn(merged, name)) skipped.push(name);
          else {
            merged[name] = entry;
            imported.push(name);
          }
        }
        if (imported.length) writeEncryptedFile(encFile, key, JSON.stringify(merged, null, 2));
        if (skipped.length) return { result: "kept-skipped" };
        // The encrypted copy is fsynced by now. Zero the plaintext before unlinking; best effort on SSDs and copy-on-write filesystems.
        try {
          const fd = openSync(plainFile, "r+");
          try {
            writeSync(fd, Buffer.alloc(statSync(plainFile).size));
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
        } catch {
          // Unlink below still runs.
        }
        unlinkSync(plainFile);
        fsyncDir(agentDir);
        return { result: "migrated" };
      });
    } catch (e) {
      return keepPlain(`migration failed: ${(e as NodeJS.ErrnoException).code ?? "could not be merged into the encrypted file"}`);
    }
    if (outcome === "gone") return result;
    if (typeof outcome === "object") return keepPlain(outcome.keep);
    if (imported.length) log(`[pista-host] mcp auth: migrated ${imported.length} MCP server sign-in(s) from mcp-auth.json into mcp-auth.enc.json`);
    if (outcome === "kept-skipped") return keepPlain(`${skipped.length} server(s) already have encrypted sign-ins and were not overwritten`);
    return result;
  } finally {
    key.fill(0); // the backend and the store hold their own copies
  }
}
