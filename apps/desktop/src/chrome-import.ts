/**
 * macOS-only reader for Chrome's saved logins. Runs in the Electron main process only: decrypted passwords
 * never reach the renderer, the host, logs or error messages. Errors carry fixed, user-safe text.
 *
 * Passwords are `v10` + AES-128-CBC with a key derived from the "Chrome Safe Storage" Keychain item.
 * The 32-byte SHA-256(host) plaintext prefix that newer Chrome adds applies to cookies only, not to
 * the logins table, so nothing is stripped here.
 */
import { execFile } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { chmod, copyFile, lstat, mkdtemp, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ImportError, type createImportStore, type ImportVault, type SkipReason } from "./login-import.ts";
import type { SaveLoginInput } from "./logins.js";

export const CHROME_UNSUPPORTED = "Importing from Chrome is only available on macOS.";
export const CHROME_NOT_FOUND = "Chrome's saved logins could not be found.";
export const CHROME_KEY_DENIED = "Chrome's encryption key could not be read. Allow access in the Keychain prompt and try again.";
export const CHROME_UNREADABLE = "Chrome's saved logins could not be read.";
export const CHROME_BAD_PROFILE = "That Chrome profile was not found.";

export const CHROME_BUSY = "An import from Chrome is already running.";
export const CHROME_COOLDOWN = "Chrome's encryption key was just denied. Wait a few seconds and try again.";
export const MAX_LOGIN_DATA_BYTES = 200_000_000;
const MAX_ROWS = 10_000;
const COOLDOWN_MS = 3000;
const TMP_PREFIX = "pista-chrome-";

let running = false;
let deniedAt = 0;
/** Test hook: clears the in-flight lock and the denial cooldown. */
export function resetChromeImportGuards() {
  running = false;
  deniedAt = 0;
}

export const defaultChromeDir = () => join(homedir(), "Library", "Application Support", "Google", "Chrome");

export interface ChromeProfile {
  dir: string;
  name: string;
}

const exists = (p: string) => stat(p).then(() => true, () => false);

export async function listChromeProfiles(chromeDir = defaultChromeDir()): Promise<ChromeProfile[]> {
  if (process.platform !== "darwin") throw new ImportError(CHROME_UNSUPPORTED);
  let cache: Record<string, { name?: unknown }>;
  try {
    const state = JSON.parse(await readFile(join(chromeDir, "Local State"), "utf8"));
    cache = state?.profile?.info_cache ?? {};
  } catch {
    throw new ImportError(CHROME_NOT_FOUND);
  }
  const out: ChromeProfile[] = [];
  for (const [dir, info] of Object.entries(cache)) {
    if (dir.includes("/") || dir.includes("\\") || dir.startsWith(".")) continue;
    if (await exists(join(chromeDir, dir, "Login Data"))) out.push({ dir, name: typeof info?.name === "string" && info.name ? info.name : dir });
  }
  return out;
}

/** Reads the "Chrome Safe Storage" passphrase from the Keychain. The OS shows its own prompt. */
export function keychainKey(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/security", ["find-generic-password", "-w", "-s", "Chrome Safe Storage", "-a", "Chrome"], { timeout: 120_000 }, (err, stdout) => {
      const key = String(stdout ?? "").trim();
      if (err || !key) reject(new ImportError(CHROME_KEY_DENIED));
      else resolve(key);
    });
  });
}

/** Returns the plaintext, or null for an unknown format or a failed decrypt. */
export function decryptChromePassword(blob: Uint8Array, aesKey: Buffer): string | null | "unknown" {
  const b = Buffer.from(blob);
  if (b.length === 0) return "";
  if (b.subarray(0, 3).toString("latin1") !== "v10") return "unknown";
  try {
    const d = createDecipheriv("aes-128-cbc", aesKey, Buffer.alloc(16, 0x20));
    return Buffer.concat([d.update(b.subarray(3)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export interface ChromeRead {
  rows: SaveLoginInput[];
  skipped: { reason: SkipReason }[];
}

const isLocalHost = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "[::1]";

export async function readChromeLogins(opts: { chromeDir?: string; profileDir: string; getKey?: () => Promise<string | Buffer> }): Promise<ChromeRead> {
  if (process.platform !== "darwin") throw new ImportError(CHROME_UNSUPPORTED);
  if (running) throw new ImportError(CHROME_BUSY);
  if (Date.now() - deniedAt < COOLDOWN_MS) throw new ImportError(CHROME_COOLDOWN);
  running = true;
  const chromeDir = opts.chromeDir ?? defaultChromeDir();
  const getKey = opts.getKey ?? keychainKey;
  let tmp: string | undefined;
  let db: DatabaseSync | undefined;
  let passphrase: string | Buffer | undefined;
  let aesKey: Buffer | undefined;
  try {
    // Only plain files that really live under the Chrome dir are copied; a symlink could point anywhere.
    const root = await realpath(chromeDir);
    const profileReal = await realpath(join(chromeDir, opts.profileDir));
    if (!profileReal.startsWith(root + sep)) throw new ImportError(CHROME_UNREADABLE);
    tmp = await mkdtemp(join(tmpdir(), TMP_PREFIX));
    await chmod(tmp, 0o700);
    const copy = join(tmp, "Login Data");
    // The journal and WAL hold writes SQLite has not checkpointed yet; they must sit next to the copy.
    for (const suffix of ["", "-journal", "-wal"]) {
      const from = join(chromeDir, opts.profileDir, "Login Data" + suffix);
      const info = await lstat(from).catch(() => null);
      if (!info && suffix) continue;
      if (!info || !info.isFile() || info.size > MAX_LOGIN_DATA_BYTES) throw new ImportError(CHROME_UNREADABLE);
      if (!(await realpath(from)).startsWith(profileReal + sep)) throw new ImportError(CHROME_UNREADABLE);
      await copyFile(from, copy + suffix);
      await chmod(copy + suffix, 0o600);
    }
    passphrase = await getKey();
    aesKey = pbkdf2Sync(passphrase, "saltysalt", 1003, 16, "sha1");
    db = new DatabaseSync(copy, { readOnly: true });
    const found = db.prepare("SELECT origin_url, username_value, password_value FROM logins WHERE blacklisted_by_user = 0 LIMIT " + MAX_ROWS).all() as {
      origin_url: string;
      username_value: string;
      password_value: Uint8Array;
    }[];
    const rows: SaveLoginInput[] = [];
    const skipped: { reason: SkipReason }[] = [];
    for (const r of found) {
      let url: URL;
      try {
        url = new URL(r.origin_url);
      } catch {
        skipped.push({ reason: "bad-url" });
        continue;
      }
      if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost(url.hostname))) {
        skipped.push({ reason: "not-https" });
        continue;
      }
      const password = decryptChromePassword(r.password_value, aesKey);
      if (password === "unknown") skipped.push({ reason: "unknown-format" });
      else if (password === null) skipped.push({ reason: "undecryptable" });
      else if (!password || !r.username_value) skipped.push({ reason: "missing-field" });
      else rows.push({ label: url.hostname, loginUrl: r.origin_url, username: r.username_value, password });
    }
    return { rows, skipped };
  } catch (e) {
    if (e instanceof ImportError && e.message === CHROME_KEY_DENIED) deniedAt = Date.now();
    // Node and sqlite errors embed paths; only our own fixed messages pass through.
    throw new ImportError(e instanceof ImportError ? e.message : CHROME_UNREADABLE);
  } finally {
    running = false;
    aesKey?.fill(0);
    if (Buffer.isBuffer(passphrase)) passphrase.fill(0);
    try {
      db?.close();
    } catch {}
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Removes pista-chrome-* temp dirs left by a crash. Only directories owned by this user; run once at app start. */
export async function sweepStaleChromeTemps(dir = tmpdir()): Promise<number> {
  let n = 0;
  const uid = process.getuid?.();
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!name.startsWith(TMP_PREFIX)) continue;
    const p = join(dir, name);
    const info = await lstat(p).catch(() => null);
    if (!info || !info.isDirectory() || (uid !== undefined && info.uid !== uid)) continue;
    if (await rm(p, { recursive: true, force: true }).then(() => true, () => false)) n++;
  }
  return n;
}

/** Validates the profile against the listing, reads it, and hands the entries to the store. */
export async function previewChromeImport(
  deps: { vault: Pick<ImportVault, "list">; chromeDir?: string; getKey?: () => Promise<string> },
  store: ReturnType<typeof createImportStore>,
  profileDir: string,
) {
  const profile = (await listChromeProfiles(deps.chromeDir)).find((p) => p.dir === profileDir);
  if (!profile) throw new ImportError(CHROME_BAD_PROFILE);
  const read = await readChromeLogins({ chromeDir: deps.chromeDir, profileDir: profile.dir, getKey: deps.getKey });
  return store.put(deps.vault, { kind: "chrome", profile: profile.name }, read.rows, read.skipped);
}
