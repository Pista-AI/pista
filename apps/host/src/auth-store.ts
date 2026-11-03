import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { clearConfigValueCache, resolveConfigValue, type CommandExec } from "./config-value.ts";

export interface EncryptedCredentialStore extends CredentialStore {
  /** Merge entries whose provider id is not already stored (migration from auth.json). */
  importPlain(data: Record<string, Credential>): Promise<{ imported: string[]; skipped: string[] }>;
  /** Raw stored map, key commands/variables unresolved. */
  exportSnapshot(): Promise<Record<string, Credential>>;
}

/** `kid` (key id) is optional: files written before it existed still load. It sits outside the AAD for the same reason. */
type Envelope = { version: 1; alg: "aes-256-gcm"; kid?: string; iv: string; tag: string; data: string };

/** First 8 bytes (hex) of HMAC-SHA256(key, "pista-auth-key-id"). Lets a load tell "different key" from "corrupt" without the key leaking. */
export function keyId(key: Buffer): string {
  return createHmac("sha256", key).update("pista-auth-key-id").digest().subarray(0, 8).toString("hex");
}

/** A failed decrypt. `reason` is "different-key" only when the file's key id proves it; "unknown" means a key id was absent, so a wrong key and damage look alike. */
export class DecryptError extends Error {
  constructor(
    readonly file: string,
    readonly reason: "different-key" | "corrupt" | "unknown",
    why: string,
  ) {
    super(`auth store: cannot decrypt ${file}: ${why}`);
    this.name = "DecryptError";
  }
}

function validate(data: unknown, label: string): Record<string, Credential> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`auth store: ${label} is not a credential map`);
  }
  for (const [providerId, c] of Object.entries(data)) {
    const v = c as Record<string, unknown> | null;
    if (v && typeof v === "object") {
      if (v.type === "api_key") {
        const env = v.env;
        const okEnv =
          env === undefined ||
          (typeof env === "object" && env !== null && !Array.isArray(env) && Object.values(env).every((e) => typeof e === "string"));
        if ((v.key === undefined || typeof v.key === "string") && okEnv) continue;
      } else if (
        v.type === "oauth" &&
        typeof v.access === "string" &&
        typeof v.refresh === "string" &&
        typeof v.expires === "number" &&
        Number.isFinite(v.expires)
      ) {
        continue;
      }
    }
    throw new Error(`auth store: invalid credential for provider "${providerId}"`);
  }
  return data as Record<string, Credential>;
}

const AAD = Buffer.from(JSON.stringify({ version: 1, alg: "aes-256-gcm" }));

/** Strict base64: rejects anything that does not re-encode to the same string. */
function strictBase64(value: string): Buffer | undefined {
  const buf = Buffer.from(value, "base64");
  return buf.toString("base64") === value ? buf : undefined;
}

/** fsync a directory so a rename in it is durable. Windows cannot open or sync directories; only there is failure ignored. */
export function fsyncDir(dir: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dir, "r");
    fsyncSync(fd);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EISDIR" || code === "EACCES")) return;
    throw e;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Decrypts `file` to its plaintext; undefined when it does not exist. Symlinks and special files are refused; a wrong key or damage throws without echoing content. */
export function readEncryptedFile(file: string, key: Buffer): string | undefined {
  let st;
  try {
    st = lstatSync(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`auth store: cannot stat ${file}`);
  }
  if (st.isSymbolicLink() || !st.isFile()) throw new Error(`auth store: ${file} is not a regular file (symlinks and special files are refused)`);
  const fail = (why: string, reason: DecryptError["reason"] = "corrupt"): never => {
    throw new DecryptError(file, reason, why);
  };
  let env: Envelope;
  try {
    env = JSON.parse(readFileSync(file, "utf-8")) as Envelope;
  } catch {
    return fail("corrupt file");
  }
  if (!env || env.version !== 1 || env.alg !== "aes-256-gcm" || typeof env.iv !== "string" || typeof env.tag !== "string" || typeof env.data !== "string") {
    return fail("corrupt file");
  }
  const iv = strictBase64(env.iv);
  const tag = strictBase64(env.tag);
  const ct = strictBase64(env.data);
  if (!iv || !tag || !ct || iv.length !== 12 || tag.length !== 16) return fail("corrupt file");
  if (env.kid !== undefined && (typeof env.kid !== "string" || !/^[0-9a-f]{16}$/.test(env.kid))) return fail("corrupt file");
  if (env.kid !== undefined && env.kid !== keyId(key)) return fail("encrypted with a different key", "different-key");
  try {
    const d = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    d.setAAD(AAD);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf-8");
  } catch {
    return fail("wrong key or corrupt file", env.kid === undefined ? "unknown" : "corrupt");
  }
}

/** Encrypts `plain` and replaces `file` atomically and durably (O_EXCL temp file, fsync, rename, directory fsync). */
export function writeEncryptedFile(file: string, key: Buffer, plain: string): void {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(AAD);
  const data = Buffer.concat([c.update(plain, "utf-8"), c.final()]);
  const env: Envelope = { version: 1, alg: "aes-256-gcm", kid: keyId(key), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32" && (statSync(dir).mode & 0o077) !== 0) chmodSync(dir, 0o700);
  const body = JSON.stringify(env);
  const tmp = `${file}.${randomUUID()}.tmp`;
  const writeTmp = (): void => {
    const fd = openSync(tmp, "wx", 0o600); // O_EXCL: never write through a pre-planted file or link
    try {
      writeSync(fd, body);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };
  try {
    try {
      writeTmp();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      rmSync(tmp, { force: true });
      writeTmp();
    }
    renameSync(tmp, file);
    fsyncDir(dir);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** Suffix of the plaintext backup a migration leaves next to the credential file: `auth.json` becomes `auth.json.migrated.bak`. */
export const BACKUP_SUFFIX = ".migrated.bak";

/** Renames a migrated plain file to `<name>.migrated.bak` (mode 0600). Throws if a backup is already there, so one is never overwritten. */
export function moveToBackup(plainFile: string): string {
  const bak = `${plainFile}${BACKUP_SUFFIX}`;
  if (existsSync(bak)) throw new Error(`a backup already exists at ${bak}`);
  chmodSync(plainFile, 0o600);
  renameSync(plainFile, bak);
  fsyncDir(dirname(bak));
  return bak;
}

/**
 * Zero-overwrites and unlinks a plaintext backup. Only a regular file is touched. Best effort on SSDs and
 * copy-on-write filesystems, which may keep old blocks. Returns false when the file was left in place.
 */
export function secureRemove(file: string): boolean {
  try {
    if (!lstatSync(file).isFile()) return false;
  } catch {
    return true; // nothing there
  }
  try {
    const fd = openSync(file, "r+");
    try {
      writeSync(fd, Buffer.alloc(statSync(file).size));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Unlink below still runs.
  }
  try {
    unlinkSync(file);
    fsyncDir(dirname(file));
    return true;
  } catch {
    return false;
  }
}

/** Once `encFile` exists and has decrypted with the current key, the plaintext backup of its migration is no longer needed. */
export function dropBackupIfEncryptedOk(encFile: string, plainFile: string, log: (line: string) => void): void {
  const bak = `${plainFile}${BACKUP_SUFFIX}`;
  if (!existsSync(encFile) || !existsSync(bak)) return;
  if (!secureRemove(bak)) log(`[pista-host] auth: could not remove the plaintext backup ${bak}; delete it yourself once you no longer need it`);
}

/** Says what happened to one file that failed to decrypt, that it is untouched, and where a plaintext backup is. */
export function describeDecryptFailure(name: string, file: string, e: unknown, plainFile: string): string {
  const bak = `${plainFile}${BACKUP_SUFFIX}`;
  let what: string;
  if (e instanceof DecryptError) {
    what =
      e.reason === "different-key"
        ? "was encrypted with a different key than the one the app supplied"
        : e.reason === "corrupt"
          ? "is corrupt"
          : "cannot be decrypted with the current key (a different key, or the file is corrupt)";
  } else {
    what = `cannot be read (${e instanceof Error ? e.message : "unknown error"})`;
  }
  const backup = existsSync(bak) ? ` The plaintext backup from the earlier migration is still at ${bak}; you can recover from it.` : "";
  return `${name} ${what}. The file has been left untouched at ${file}.${backup}`;
}

/** Mutual exclusion is in-process only (one host per PISTA_HOME); Pi's cross-process lockfile is not replicated. */
export function createEncryptedCredentialStore({
  file,
  key: keyArg,
  exec,
}: {
  file: string;
  key: Buffer;
  exec?: CommandExec;
}): EncryptedCredentialStore {
  if (!Buffer.isBuffer(keyArg) || keyArg.length !== 32) throw new Error("auth store: key must be 32 bytes");
  const key = Buffer.from(keyArg);

  const load = (): Record<string, Credential> => {
    const plain = readEncryptedFile(file, key);
    if (plain === undefined) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(plain);
    } catch {
      throw new DecryptError(file, "corrupt", "corrupt file");
    }
    return validate(parsed, file);
  };

  const save = (map: Record<string, Credential>): void => writeEncryptedFile(file, key, JSON.stringify(map, null, 2));

  // In-process mutex: every write runs after the previous one settles.
  let chain: Promise<unknown> = Promise.resolve();
  const locked = <T>(fn: () => Promise<T>, options?: AuthOperationOptions): Promise<T> => {
    const run = chain.catch(() => {}).then(async () => {
      options?.signal?.throwIfAborted();
      return fn();
    });
    chain = run;
    return run;
  };

  return {
    async read(providerId, options) {
      options?.signal?.throwIfAborted();
      const c = load()[providerId];
      if (!c) return undefined;
      if (c.type !== "api_key" || c.key === undefined) return structuredClone(c);
      return { ...c, key: resolveConfigValue(c.key, c.env, { exec }) };
    },
    async list(options): Promise<readonly CredentialInfo[]> {
      options?.signal?.throwIfAborted();
      return Object.entries(load()).map(([providerId, c]) => ({ providerId, type: c.type }));
    },
    modify(providerId, fn, options) {
      return locked(async () => {
        const current = load();
        const next = await fn(current[providerId] ? structuredClone(current[providerId]) : undefined);
        if (next === undefined) return current[providerId];
        options?.signal?.throwIfAborted();
        save({ ...current, [providerId]: next });
        clearConfigValueCache();
        return next;
      }, options);
    },
    delete(providerId, options) {
      return locked(async () => {
        const current = load();
        if (!(providerId in current)) return;
        delete current[providerId];
        save(current);
        clearConfigValueCache();
      }, options);
    },
    importPlain(data) {
      return locked(async () => {
        const incoming = validate(data, "import data");
        const current = load();
        const imported: string[] = [];
        const skipped: string[] = [];
        for (const [id, c] of Object.entries(incoming)) {
          if (id in current) skipped.push(id);
          else {
            current[id] = structuredClone(c);
            imported.push(id);
          }
        }
        if (imported.length) save(current);
        return { imported, skipped };
      });
    },
    async exportSnapshot() {
      return structuredClone(load());
    },
  };
}
