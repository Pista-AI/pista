import { randomBytes, randomUUID } from "node:crypto";
import { chmod, link, mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { VaultCrypto } from "./logins.js";

export const NO_AUTH_KEYCHAIN_MESSAGE =
  "Pista needs the OS keychain to protect provider credentials. None is available on this system.";

const HEX_KEY = /^[0-9a-f]{64}$/;

async function syncDir(dir: string): Promise<void> {
  try {
    const fh = await open(dir, "r");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EISDIR" || code === "EACCES")) return;
    throw e;
  }
}

/** Environment for the host child: the user's shell must never supply the auth key, its channel flag or plain mode. */
export function hostChildEnv(base: NodeJS.ProcessEnv, extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.PISTA_AUTH_KEY;
  delete env.PISTA_AUTH_KEY_PORT;
  delete env.PISTA_AUTH_PLAIN;
  return { ...env, ...extra };
}

/** Keeps the host's data key, wrapped by the OS keychain, in a small file in userData. */
export function createAuthKeyVault(options: { file: string; crypto: VaultCrypto }) {
  const { file, crypto } = options;

  async function read(): Promise<Buffer | undefined> {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("The credential key file could not be read.");
    }
    const corrupt = new Error("The credential key file is corrupt. It was left unchanged.");
    let blob: Buffer;
    try {
      const data = JSON.parse(raw) as { version?: unknown; blob?: unknown };
      if (data.version !== 1 || typeof data.blob !== "string") throw corrupt;
      blob = Buffer.from(data.blob, "base64");
    } catch {
      throw corrupt;
    }
    let hex: string;
    try {
      hex = await crypto.decrypt(blob);
    } catch {
      throw new Error("The credential key could not be decrypted with the OS keychain. The file was left unchanged.");
    }
    if (!HEX_KEY.test(hex)) throw corrupt;
    return Buffer.from(hex, "hex");
  }

  /** Writes the key file only if none exists (hard link, so an existing file is never replaced). False when one already exists. */
  async function createExclusive(blob: Buffer): Promise<boolean> {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    if (process.platform !== "win32" && ((await stat(dirname(file))).mode & 0o077) !== 0) await chmod(dirname(file), 0o700);
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      const fh = await open(tmp, "wx", 0o600);
      try {
        await fh.writeFile(JSON.stringify({ version: 1, blob: blob.toString("base64") }));
        await fh.sync();
      } finally {
        await fh.close();
      }
      try {
        await link(tmp, file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw error;
      }
      await syncDir(dirname(file));
      return true;
    } finally {
      try {
        await unlink(tmp);
      } catch {
        // The temp file may not exist.
      }
    }
  }

  return {
    /** Returns the 32-byte key, creating and storing a new one on first use. */
    async load(): Promise<Buffer> {
      let available = false;
      try {
        available = await crypto.isAvailable();
      } catch {
        // A crypto that throws counts as unavailable.
      }
      if (!available) throw new Error(NO_AUTH_KEYCHAIN_MESSAGE);
      const existing = await read();
      if (existing) return existing;
      const key = randomBytes(32);
      if (await createExclusive(await crypto.encrypt(key.toString("hex")))) return key;
      // Another instance created the file first: its key is the only one, so use it.
      key.fill(0);
      const winner = await read();
      if (!winner) throw new Error("The credential key file could not be read.");
      return winner;
    },
  };
}

/** The slice of Electron's UtilityProcess used for the key handoff. */
export interface KeyReceiver {
  postMessage(message: unknown): void;
}

/** Posts the key to the host as a Uint8Array copy (structured clone), then zeroes the caller's buffer. Never logs. */
export function sendKeyToHost(child: KeyReceiver, key: Buffer): void {
  const copy = new Uint8Array(key);
  try {
    child.postMessage({ type: "auth-key", key: copy });
  } finally {
    copy.fill(0);
    key.fill(0);
  }
}
