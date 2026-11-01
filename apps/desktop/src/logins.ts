import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
    // Only meaningful on Linux; other platforms report "unknown", which is fine.
    backend: () => s.getSelectedStorageBackend(),
    encrypt: (text) => s.encryptStringAsync(text),
    decrypt: async (blob) => (await s.decryptStringAsync(blob)).result,
  };
}

export interface SavedLoginMeta {
  id: string;
  label: string;
  origin: string;
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

function parseOrigin(loginUrl: string): { origin: string; url: URL } {
  let url: URL;
  try {
    url = new URL(loginUrl);
  } catch {
    throw new Error("The login URL is not a valid URL.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("Saved logins need an https:// login URL.");
  }
  return { origin: url.origin, url };
}

export function createLoginVault(options: { file: string; crypto: VaultCrypto }) {
  const { file, crypto } = options;

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
      return data;
    } catch {
      throw new Error("The saved logins file is corrupt. It was left unchanged.");
    }
  }

  async function store(data: VaultFile): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, file);
  }

  const meta = (l: StoredLogin): SavedLoginMeta => ({
    id: l.id,
    label: l.label,
    origin: l.origin,
    username: l.username,
  });

  return {
    async status(): Promise<{ available: boolean; backend: string }> {
      const backend = crypto.backend();
      return { available: (await crypto.isAvailable()) && backend !== "basic_text", backend };
    },

    async list(): Promise<SavedLoginMeta[]> {
      return (await load()).logins.map(meta);
    },

    async save(input: SaveLoginInput): Promise<SavedLoginMeta> {
      if (!(await this.status()).available) throw new Error(NO_KEYCHAIN_MESSAGE);
      const { origin } = parseOrigin(input.loginUrl);
      const data = await load();
      const blob = (await crypto.encrypt(JSON.stringify({ username: input.username, password: input.password }))).toString("base64");
      const entry: StoredLogin = {
        id: randomUUID(),
        label: input.label,
        origin,
        loginUrl: input.loginUrl,
        username: input.username,
        blob,
      };
      data.logins = data.logins.filter((l) => l.origin !== origin);
      data.logins.push(entry);
      await store(data);
      return meta(entry);
    },

    async remove(id: string): Promise<void> {
      const data = await load();
      data.logins = data.logins.filter((l) => l.id !== id);
      await store(data);
    },

    /**
     * Only the fill engine calls this. The result never crosses IPC.
     */
    async get(id: string): Promise<{ meta: SavedLoginMeta; loginUrl: string; username: string; password: string }> {
      const entry = (await load()).logins.find((l) => l.id === id);
      if (!entry) throw new Error("No such saved login.");
      let secret: { username: string; password: string };
      try {
        secret = JSON.parse(await crypto.decrypt(Buffer.from(entry.blob, "base64")));
      } catch {
        throw new Error("The saved login could not be decrypted.");
      }
      return { meta: meta(entry), loginUrl: entry.loginUrl, username: secret.username, password: secret.password };
    },
  };
}
