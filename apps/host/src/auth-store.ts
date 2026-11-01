import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { resolveConfigValue, type CommandExec } from "./config-value.ts";

export interface EncryptedCredentialStore extends CredentialStore {
  /** Merge entries whose provider id is not already stored (migration from auth.json). */
  importPlain(data: Record<string, Credential>): Promise<{ imported: string[]; skipped: string[] }>;
  /** Raw stored map, key commands/variables unresolved. */
  exportSnapshot(): Promise<Record<string, Credential>>;
}

type Envelope = { version: 1; alg: "aes-256-gcm"; iv: string; tag: string; data: string };

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
    if (!existsSync(file)) return {};
    const fail = (why: string): never => {
      throw new Error(`auth store: cannot decrypt ${file}: ${why}`);
    };
    let env: Envelope;
    try {
      env = JSON.parse(readFileSync(file, "utf-8")) as Envelope;
    } catch {
      return fail("corrupt file");
    }
    if (!env || env.version !== 1 || env.alg !== "aes-256-gcm" || typeof env.iv !== "string" || typeof env.tag !== "string" || typeof env.data !== "string" || Buffer.from(env.iv, "base64").length !== 12 || Buffer.from(env.tag, "base64").length !== 16) {
      return fail("corrupt file");
    }
    let plain: string;
    try {
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"), { authTagLength: 16 });
      d.setAuthTag(Buffer.from(env.tag, "base64"));
      plain = Buffer.concat([d.update(Buffer.from(env.data, "base64")), d.final()]).toString("utf-8");
    } catch {
      return fail("wrong key or corrupt file");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(plain);
    } catch {
      return fail("corrupt file");
    }
    return validate(parsed, file);
  };

  const save = (map: Record<string, Credential>): void => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([c.update(JSON.stringify(map, null, 2), "utf-8"), c.final()]);
    const env: Envelope = { version: 1, alg: "aes-256-gcm", iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      const fd = openSync(tmp, "w", 0o600);
      try {
        writeSync(fd, JSON.stringify(env));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, file);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
  };

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
        return next;
      }, options);
    },
    delete(providerId, options) {
      return locked(async () => {
        const current = load();
        if (!(providerId in current)) return;
        delete current[providerId];
        save(current);
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
