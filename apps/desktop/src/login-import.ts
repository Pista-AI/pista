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
    const rawUrl = cell(col.url).split(",")[0].trim();
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

/** Saves each row through the vault. Failures are counted, never described. */
export async function importLogins(vault: ImportVault, rows: SaveLoginInput[]): Promise<{ imported: number; replaced: number; failed: number }> {
  const seen = new Set((await vault.list()).map((l) => l.origin));
  let imported = 0;
  let replaced = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await vault.save(row);
      const origin = new URL(row.loginUrl).origin;
      if (seen.has(origin)) replaced++;
      seen.add(origin);
      imported++;
    } catch {
      failed++;
    }
  }
  return { imported, replaced, failed };
}
