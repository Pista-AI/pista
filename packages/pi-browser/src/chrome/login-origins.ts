import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The only query run against the password manager's database: the two plain-text address columns, never a username or password column. */
export const LOGIN_ORIGINS_SQL = "SELECT origin_url, signon_realm FROM logins";
const FILES = ["Login Data", "Login Data For Account"];

export interface LoginOriginsDeps {
  /** Runs `sql` read-only on the SQLite file at `path` and returns its rows. Defaults to node:sqlite (Node 22.5+, so also Electron's utility process). */
  query?: (path: string, sql: string) => Promise<Record<string, unknown>[]>;
}

export async function sqliteQuery(path: string, sql: string) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare(sql).all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

/**
 * Origins (scheme://host[:port]) the browser profile has saved logins for. Chrome keeps its database open, so a copy (with its
 * journal and WAL) is read, from a private temp folder that is removed again. Throws when a database exists but cannot be read:
 * callers treat that as "unknown", not as "none".
 */
export async function readLoginOrigins(profileDir: string, deps: LoginOriginsDeps = {}): Promise<string[]> {
  const query = deps.query ?? sqliteQuery;
  const origins = new Set<string>();
  for (const file of FILES) {
    const source = join(profileDir, "Default", file);
    if (!existsSync(source)) continue;
    const tmp = mkdtempSync(join(tmpdir(), "pista-logins-"));
    try {
      const copy = join(tmp, "Login Data");
      for (const suffix of ["", "-journal", "-wal"]) if (existsSync(source + suffix)) copyFileSync(source + suffix, copy + suffix);
      for (const row of await query(copy, LOGIN_ORIGINS_SQL)) {
        for (const value of [row.origin_url, row.signon_realm]) {
          try {
            const url = new URL(String(value));
            if (url.protocol === "http:" || url.protocol === "https:") origins.add(url.origin);
          } catch {
            // android:// realms and the like name no website
          }
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return [...origins];
}
