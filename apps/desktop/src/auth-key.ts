import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { VaultCrypto } from "./logins.js";

export const NO_AUTH_KEYCHAIN_MESSAGE =
  "Pista needs the OS keychain to protect provider credentials. None is available on this system.";

const HEX_KEY = /^[0-9a-f]{64}$/;

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

  async function store(blob: Buffer): Promise<void> {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify({ version: 1, blob: blob.toString("base64") }), { mode: 0o600 });
      await chmod(tmp, 0o600);
      await rename(tmp, file);
    } catch (error) {
      try {
        await unlink(tmp);
      } catch {
        // The temp file may not exist.
      }
      throw error;
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
      await store(await crypto.encrypt(key.toString("hex")));
      return key;
    },
  };
}

/** Writes the key as one hex line and closes the stream. Never logs; messages carry no key content. */
export function writeKeyToStdin(stdin: NodeJS.WritableStream, key: Buffer, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stdin.removeListener("error", onError);
      stdin.removeListener("close", onClose);
      if (error) reject(error);
      else resolve();
    };
    const onError = () => finish(new Error("The host did not accept the auth key."));
    const onClose = () => finish();
    const timer = setTimeout(() => finish(new Error("The host did not accept the auth key.")), timeoutMs);
    stdin.once("error", onError);
    stdin.once("close", onClose);
    stdin.end(`${key.toString("hex")}\n`, () => finish());
  });
}
