import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface VaultCrypto {
  isAvailable(): Promise<boolean>;
  backend(): string;
  encrypt(text: string): Promise<Buffer>;
  decrypt(blob: Buffer): Promise<string>;
}

export interface SafeStorageLike {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  getSelectedStorageBackend(): string;
  encryptStringAsync(text: string): Promise<Buffer>;
  decryptStringAsync(blob: Buffer): Promise<{ result: string }>;
}

/** Maps Electron's async safeStorage API (OS keychain) to the vault's crypto interface. */
export function safeStorageCrypto(s: SafeStorageLike): VaultCrypto {
  return {
    isAvailable: () => s.isAsyncEncryptionAvailable(),
    // Only meaningful on Linux; Electron throws on macOS/Windows, so report "unknown" there.
    backend: () => {
      try {
        return s.getSelectedStorageBackend();
      } catch {
        return "unknown";
      }
    },
    encrypt: (text) => s.encryptStringAsync(text),
    decrypt: async (blob) => (await s.decryptStringAsync(blob)).result,
  };
}

export interface SavedLoginMeta {
  id: string;
  label: string;
  origin: string;
  // Intentionally in the clear so the list can show it; it is not a secret.
  username: string;
}

export interface SaveLoginInput {
  label: string;
  loginUrl: string;
  username: string;
  password: string;
}

interface StoredLogin extends SavedLoginMeta {
  loginUrl: string;
  blob: string;
}

interface VaultFile {
  version: 1;
  logins: StoredLogin[];
}

export const NO_KEYCHAIN_MESSAGE = "Saved logins need an OS keychain. None is available on this system.";

function parseOrigin(loginUrl: string): { origin: string; loginUrl: string } {
  let url: URL;
  try {
    url = new URL(loginUrl);
  } catch {
    throw new Error("The login URL is not a valid URL.");
  }
  if (url.username || url.password) throw new Error("The login URL must not contain a username or password.");
  const host = url.hostname.replace(/\.$/, "");
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("Saved logins need an https:// login URL.");
  }
  url.hostname = host;
  return { origin: url.origin, loginUrl: url.origin + url.pathname };
}

const isStr = (v: unknown): v is string => typeof v === "string";
const nonEmpty = (v: unknown, max: number): boolean => isStr(v) && v.length > 0 && v.length <= max;

export function createLoginVault(options: { file: string; crypto: VaultCrypto }) {
  const { file, crypto } = options;
  let queue: Promise<unknown> = Promise.resolve();
  // Mutations run one after another so concurrent saves cannot lose each other's writes.
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  }

  async function load(): Promise<VaultFile> {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, logins: [] };
      throw new Error("The saved logins file could not be read.");
    }
    try {
      const data = JSON.parse(raw) as VaultFile;
      if (data.version !== 1 || !Array.isArray(data.logins)) throw new Error("bad shape");
      for (const l of data.logins as unknown as Record<string, unknown>[]) {
        if (typeof l !== "object" || l === null) throw new Error("bad entry");
        for (const k of ["id", "label", "origin", "loginUrl", "username", "blob"]) {
          if (!isStr(l[k])) throw new Error("bad entry");
        }
      }
      return data;
    } catch {
      throw new Error("The saved logins file is corrupt. It was left unchanged.");
    }
  }

  async function store(data: VaultFile): Promise<void> {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
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

  const meta = (l: StoredLogin): SavedLoginMeta => ({
    id: l.id,
    label: l.label,
    origin: l.origin,
    username: l.username,
  });

  /** A crypto backend that throws counts as unavailable; its error never surfaces. */
  const status = async (): Promise<{ available: boolean; backend: string }> => {
    try {
      const backend = crypto.backend();
      return { available: (await crypto.isAvailable()) && backend !== "basic_text", backend };
    } catch {
      return { available: false, backend: "unknown" };
    }
  };

  return {
    status,

    async list(): Promise<SavedLoginMeta[]> {
      return (await load()).logins.map(meta);
    },

    save(input: SaveLoginInput): Promise<SavedLoginMeta> {
      return serial(async () => {
        if (!nonEmpty(input.label, 80)) throw new Error("The label must be 1 to 80 characters.");
        if (!nonEmpty(input.username, 200)) throw new Error("The username must be 1 to 200 characters.");
        if (!nonEmpty(input.password, 1000)) throw new Error("The password must be 1 to 1000 characters.");
        if (!(await status()).available) throw new Error(NO_KEYCHAIN_MESSAGE);
        const { origin, loginUrl } = parseOrigin(input.loginUrl);
        const data = await load();
        const secret = JSON.stringify({ origin, username: input.username, password: input.password });
        const entry: StoredLogin = {
          id: randomUUID(),
          label: input.label,
          origin,
          loginUrl,
          username: input.username,
          blob: (await crypto.encrypt(secret)).toString("base64"),
        };
        data.logins = data.logins.filter((l) => l.origin !== origin);
        data.logins.push(entry);
        await store(data);
        return meta(entry);
      });
    },

    remove(id: string): Promise<void> {
      return serial(async () => {
        const data = await load();
        const logins = data.logins.filter((l) => l.id !== id);
        if (logins.length === data.logins.length) return;
        await store({ version: 1, logins });
      });
    },

    /**
     * Only the fill engine calls this. The result never crosses IPC.
     */
    async get(id: string): Promise<{ meta: SavedLoginMeta; loginUrl: string; username: string; password: string }> {
      const entry = (await load()).logins.find((l) => l.id === id);
      if (!entry) throw new Error("No such saved login.");
      let secret: { origin?: unknown; username?: unknown; password?: unknown };
      try {
        secret = JSON.parse(await crypto.decrypt(Buffer.from(entry.blob, "base64")));
      } catch {
        throw new Error("The saved login could not be decrypted.");
      }
      // safeStorage is unauthenticated encryption on some platforms, so a blob alone proves nothing.
      // Binding origin and username inside it stops someone with write access to the file from
      // re-pointing a password at another origin or swapping blobs between entries.
      if (
        !nonEmpty(secret.origin, 2000) ||
        !nonEmpty(secret.username, 200) ||
        !nonEmpty(secret.password, 1000) ||
        secret.origin !== entry.origin ||
        secret.username !== entry.username
      ) {
        throw new Error("Saved login is damaged.");
      }
      return { meta: meta(entry), loginUrl: entry.loginUrl, username: secret.username as string, password: secret.password as string };
    },
  };
}
