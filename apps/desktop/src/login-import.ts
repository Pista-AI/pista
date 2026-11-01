/**
 * Password-manager CSV import. Pure: runs in the Electron main process only, so no row content
 * (URLs, usernames, passwords) may be returned to the renderer, logged, or put in an error.
 * Results carry counts only.
 */
import type { SaveLoginInput, SavedLoginMeta } from "./logins.js";

export type SkipReason = "no-url" | "not-https" | "not-login" | "missing-field" | "bad-url";
export interface ParsedLogins {
  rows: SaveLoginInput[];
  skipped: { reason: SkipReason; count: number }[];
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
  const skip = (r: SkipReason) => counts.set(r, (counts.get(r) ?? 0) + 1);
  const rows: SaveLoginInput[] = [];
  const body = table.slice(1);
  for (const r of body) {
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
  return { rows, skipped: [...counts].map(([reason, count]) => ({ reason, count })), total: body.length };
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

export interface ImportDeps {
  vault: ImportVault;
  /** Resolves the chosen file path, or null when the dialog was canceled. */
  pick(): Promise<string | null>;
  size(path: string): Promise<number>;
  read(path: string): Promise<Buffer>;
  trash(path: string): Promise<void>;
}

/** The whole import flow. Every failure surfaces as a fixed message; the result holds counts only. */
export async function runLoginImport(deps: ImportDeps, opts: { trash?: boolean } = {}) {
  let path: string | null;
  let parsed: ParsedLogins;
  try {
    path = await deps.pick();
    if (!path) return { imported: 0, replaced: 0, skipped: 0, failed: 0, canceled: true as const };
    if ((await deps.size(path)) > MAX_IMPORT_BYTES) throw new ImportError(TOO_LARGE);
    const bytes = await deps.read(path);
    if (bytes.length > MAX_IMPORT_BYTES) throw new ImportError(TOO_LARGE);
    parsed = parseLoginCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (e) {
    throw new ImportError(e instanceof ImportError ? e.message : UNREADABLE);
  }
  const done = await importLogins(deps.vault, parsed.rows);
  // Trashing is reversible, and only done when every importable row was stored; otherwise the user still needs the file.
  const trashed = opts.trash === true && done.imported > 0 && done.failed === 0 ? await deps.trash(path).then(() => true, () => false) : false;
  return { ...done, skipped: parsed.skipped.reduce((n, x) => n + x.count, 0), trashed };
}
