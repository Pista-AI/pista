/**
 * Password-manager CSV import. Pure: runs in the Electron main process only, so no row content
 * (URLs, usernames, passwords) may be returned to the renderer, logged, or put in an error.
 * Results carry counts only.
 */
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { SaveLoginInput, SavedLoginMeta } from "./logins.js";

export type SkipReason = "no-url" | "not-https" | "not-login" | "missing-field" | "bad-url" | "duplicate" | "undecryptable" | "unknown-format";
export interface ParsedLogins {
  rows: SaveLoginInput[];
  skipped: { reason: SkipReason; count: number }[];
  /** The same skips one by one, with the 1-based CSV record number (the header is record 1). No row content. */
  skippedRows: { line: number; reason: SkipReason }[];
  total: number;
}
export interface ImportVault {
  list(): Promise<SavedLoginMeta[]>;
  save(input: SaveLoginInput): Promise<unknown>;
}

export const NOT_AN_EXPORT = "This doesn't look like a password export.";
export const UNREADABLE = "That file could not be read.";
export const TOO_LARGE = "That file is too large to be a password export.";
export const MAX_IMPORT_BYTES = 5_000_000;
/** Errors with a fixed, safe message. Anything else is replaced by UNREADABLE, since Node errors embed file paths. */
export class ImportError extends Error {}

/** RFC 4180: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF or LF. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (quoted) throw new ImportError(NOT_AN_EXPORT);
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? "").trim() !== "");
}

const URL_COLS = ["url", "login_uri", "website", "web site", "login url"];
const USER_COLS = ["username", "login_username", "user name", "login", "email"];
const PASS_COLS = ["password", "login_password"];
const LABEL_COLS = ["name", "title"];

const findCol = (header: string[], names: string[]) => {
  for (const n of names) {
    const i = header.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
};

const isLocalHost = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "[::1]";

export function parseLoginCsv(text: string): ParsedLogins {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = { url: findCol(header, URL_COLS), user: findCol(header, USER_COLS), pass: findCol(header, PASS_COLS), label: findCol(header, LABEL_COLS), type: header.indexOf("type") };
  if (col.url < 0 || col.pass < 0) throw new ImportError(NOT_AN_EXPORT);
  const counts = new Map<SkipReason, number>();
  const skippedRows: { line: number; reason: SkipReason }[] = [];
  let line = 1;
  const skip = (r: SkipReason) => {
    counts.set(r, (counts.get(r) ?? 0) + 1);
    skippedRows.push({ line, reason: r });
  };
  const rows: SaveLoginInput[] = [];
  const body = table.slice(1);
  for (const r of body) {
    line++;
    const cell = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    if (col.type >= 0 && cell(col.type).toLowerCase() !== "login") {
      skip("not-login");
      continue;
    }
    // Bitwarden may hold several URLs in one field; take the first.
    const rawUrl = cell(col.url).split(/[\r\n]+|,(?=\s*https?:)/)[0].trim();
    if (!rawUrl) {
      skip("no-url");
      continue;
    }
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      skip("bad-url");
      continue;
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost(url.hostname))) {
      skip("not-https");
      continue;
    }
    const username = cell(col.user);
    const password = r[col.pass] ?? "";
    if (!username || !password) {
      skip("missing-field");
      continue;
    }
    rows.push({ label: cell(col.label) || url.hostname, loginUrl: rawUrl, username, password });
  }
  return { rows, skipped: [...counts].map(([reason, count]) => ({ reason, count })), skippedRows, total: body.length };
}

/**
 * Saves each row through the vault. Failures are counted, never described.
 * Rows are deduplicated by origin first (the last one wins, as the vault keeps one login per origin),
 * so `imported` and `replaced` count what actually ended up stored.
 */
export async function importLogins(vault: ImportVault, rows: SaveLoginInput[]): Promise<{ imported: number; replaced: number; failed: number }> {
  const existing = new Set((await vault.list()).map((l) => l.origin));
  const byOrigin = new Map<string, SaveLoginInput>();
  let failed = 0;
  for (const row of rows) {
    try {
      const origin = new URL(row.loginUrl).origin;
      byOrigin.delete(origin);
      byOrigin.set(origin, row);
    } catch {
      failed++;
    }
  }
  let imported = 0;
  let replaced = 0;
  for (const [origin, row] of byOrigin) {
    try {
      await vault.save(row);
      imported++;
      if (existing.has(origin)) replaced++;
    } catch {
      failed++;
    }
  }
  return { imported, replaced, failed };
}

/** Where a pending import came from. */
export type ImportSource = { kind: "csv"; fileName: string } | { kind: "chrome"; profile: string };
export interface PreviewRow {
  id: string;
  origin: string;
  username: string;
  label?: string;
  /** True when a saved login for this origin already exists and would be overwritten. */
  replaces: boolean;
}
export interface ImportPreview {
  token: string;
  source: ImportSource;
  rows: PreviewRow[];
  skipped: { line?: number; reason: SkipReason }[];
}
export const IMPORT_EXPIRED = "That import has expired. Choose the file again.";
export const VAULT_UNAVAILABLE = "Saved logins could not be read.";
export const IMPORT_TTL_MS = 5 * 60_000;

interface Pending {
  expires: number;
  rows: SaveLoginInput[];
  skipped: number;
  /** Main-process only: the file to trash after a clean import. */
  trashPath?: string;
}

/**
 * Holds already-parsed entries (with passwords) in memory until the user confirms. Takes entries from any source;
 * the renderer only ever sees the preview, which has no passwords. One pending import at a time. A token works once.
 */
export function createImportStore(opts: { now?: () => number; ttlMs?: number; token?: () => string } = {}) {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? IMPORT_TTL_MS;
  const newToken = opts.token ?? (() => randomUUID());
  const pending = new Map<string, Pending>();

  const take = (token: unknown): Pending => {
    const entry = typeof token === "string" ? pending.get(token) : undefined;
    pending.delete(token as string);
    if (!entry || entry.expires <= now()) throw new ImportError(IMPORT_EXPIRED);
    return entry;
  };

  return {
    /** Dedupes by origin (the last row wins, as the vault keeps one login per origin) and returns the password-free preview. */
    async put(
      vault: Pick<ImportVault, "list">,
      source: ImportSource,
      rows: SaveLoginInput[],
      skipped: { line?: number; reason: SkipReason }[],
      trashPath?: string,
    ): Promise<ImportPreview> {
      const existing = new Set((await vault.list().catch(() => Promise.reject(new ImportError(VAULT_UNAVAILABLE)))).map((l) => l.origin));
      const byOrigin = new Map<string, SaveLoginInput>();
      const skippedAll = [...skipped];
      for (const row of rows) {
        try {
          const origin = new URL(row.loginUrl).origin;
          if (byOrigin.delete(origin)) skippedAll.push({ reason: "duplicate" });
          byOrigin.set(origin, row);
        } catch {
          skippedAll.push({ reason: "bad-url" });
        }
      }
      const kept = [...byOrigin];
      const token = newToken();
      pending.clear();
      pending.set(token, { expires: now() + ttl, rows: kept.map(([, r]) => r), skipped: skippedAll.length, trashPath });
      // Plaintext passwords must not outlive the window to confirm, even if nobody commits or cancels.
      setTimeout(() => pending.delete(token), ttl).unref();
      return {
        token,
        source,
        rows: kept.map(([origin, r], i) => ({ id: String(i), origin, username: r.username, label: r.label, replaces: existing.has(origin) })),
        skipped: skippedAll,
      };
    },
    /** Saves the chosen rows. The token is spent whether this succeeds or fails. */
    async commit(
      vault: ImportVault,
      trash: (path: string) => Promise<void>,
      input: { token: string; ids: string[]; trashFile?: boolean },
    ) {
      const entry = take(input.token);
      const ids = new Set(Array.isArray(input.ids) ? input.ids.map(String) : []);
      const chosen = entry.rows.filter((_, i) => ids.has(String(i)));
      const done = await importLogins(vault, chosen);
      // Trashing is reversible, and only done when every previewed row was chosen and stored; otherwise the user still needs the file.
      const trashed =
        input.trashFile === true && entry.trashPath && chosen.length === entry.rows.length && done.imported > 0 && done.failed === 0 ? await trash(entry.trashPath).then(() => true, () => false) : false;
      return { ...done, skipped: entry.skipped + (entry.rows.length - chosen.length), trashed };
    },
    clear() {
      pending.clear();
    },
    cancel(token: unknown) {
      if (typeof token === "string") pending.delete(token);
    },
  };
}

export interface ImportDeps {
  vault: ImportVault;
  /** Resolves the chosen file path, or null when the dialog was canceled. */
  pick(): Promise<string | null>;
  size(path: string): Promise<number>;
  read(path: string): Promise<Buffer>;
}

/** Picks and parses a CSV into the store. Every failure surfaces as a fixed message; the preview holds no passwords. */
export async function previewLoginImport(deps: ImportDeps, store: ReturnType<typeof createImportStore>) {
  let path: string | null;
  let parsed: ParsedLogins;
  try {
    path = await deps.pick();
    if (!path) return { canceled: true as const };
    if ((await deps.size(path)) > MAX_IMPORT_BYTES) throw new ImportError(TOO_LARGE);
    const bytes = await deps.read(path);
    if (bytes.length > MAX_IMPORT_BYTES) throw new ImportError(TOO_LARGE);
    parsed = parseLoginCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (e) {
    throw new ImportError(e instanceof ImportError ? e.message : UNREADABLE);
  }
  return store.put(deps.vault, { kind: "csv", fileName: basename(path) }, parsed.rows, parsed.skippedRows, path);
}
