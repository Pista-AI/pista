import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { realpathLoose } from "./project-files.ts";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

type Entry = Record<string, unknown>;

function parseArray(raw: string): Entry[] | null {
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.filter((e): e is Entry => Boolean(e) && typeof e === "object" && !Array.isArray(e)) : null;
  } catch {
    return null;
  }
}

/** A manifest row is the same transaction when date and amount match, the currency too when both rows give one, and the vendor too when both give one (by slug). */
export type RowKey = { date: string; amount: number; currency?: string; /** must match a row that has a vendor */ vendor?: string; /** only a preference among rows that match */ hint?: string };
const two = (n: unknown) => Math.abs(Number(n)).toFixed(2);
/** The vendor label for a file name: lowercase letters and digits, dashes between. */
export const vendorSlug = (label: string) => label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "vendor";
const slugOf = (v: unknown) => (typeof v === "string" && v.trim() ? vendorSlug(v) : "");
const sameRow = (e: Entry, k: RowKey) =>
  String(e.date ?? "").trim() === k.date && two(e.amount) === two(k.amount) && (!e.currency || !k.currency || String(e.currency).toUpperCase() === k.currency.toUpperCase())
  && (!slugOf(e.vendor) || !slugOf(k.vendor) || slugOf(e.vendor) === slugOf(k.vendor));
const rowKeyOf = (e: Entry): RowKey => ({ date: String(e.date ?? "").trim(), amount: Number(e.amount), currency: typeof e.currency === "string" ? e.currency : undefined, vendor: typeof e.vendor === "string" ? e.vendor : undefined });
/** Among the rows that match: the one whose vendor is the hint, else the first not yet fetched, else the first. */
function pickRow(rows: Entry[], k: RowKey): number {
  const hits = rows.map((_, i) => i).filter((i) => sameRow(rows[i]!, k));
  const h = slugOf(k.hint ?? k.vendor);
  return hits.find((i) => h && slugOf(rows[i]!.vendor) === h) ?? hits.find((i) => !rows[i]!.file) ?? hits[0] ?? -1;
}
const manifestFile = (workspace: string) => join(workspace, "invoices", "manifest.json");
const readRows = (file: string): Entry[] | null => (existsSync(file) ? parseArray(readFileSync(file, "utf8")) : []);

/** The row for this transaction, when the manifest has one. */
export function findRow(workspace: string, key: RowKey): Entry | undefined {
  try {
    const rows = readRows(manifestFile(workspace));
    return rows?.[pickRow(rows, key)];
  } catch {
    return undefined;
  }
}


/**
 * Merges a freshly written manifest into the one on disk, keyed by date and amount (the vendor label does not matter): the new entry wins field by field
 * (except that a "pending" entry never overwrites the status, file and note of an entry already worked on), and old entries
 * missing from the new array are kept. A missing or malformed old file, or an unreadable new one, leaves the new content as is. Never throws.
 */
export function mergeManifest(oldRaw: string | undefined, newRaw: string): string {
  const next = parseArray(newRaw);
  const old = oldRaw === undefined ? null : parseArray(oldRaw);
  if (!next || !old || old.length === 0) return newRaw;
  const used = new Set<Entry>();
  const merged: Entry[] = next.map((e) => {
    const prev = old.find((o) => !used.has(o) && sameRow(o, rowKeyOf(e)));
    if (!prev) return e;
    used.add(prev);
    const keepProgress = e.status === "pending" && prev.status !== undefined && prev.status !== "pending";
    return { ...prev, ...e, ...(keepProgress ? { status: prev.status, file: prev.file, note: prev.note } : {}) };
  });
  for (const e of old) if (!used.has(e)) merged.push(e);
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/**
 * Sets fields on the row for this transaction (its `vendor` label is kept) or appends one with `patch.vendor`. Written to a temp file and renamed.
 * A manifest that is not a JSON array is left alone (false): the model's own write still happens. Never throws.
 */
export function upsertRow(workspace: string, key: RowKey, patch: Entry): boolean {
  try {
    const file = manifestFile(workspace);
    const rows = readRows(file);
    if (!rows) return false;
    const i = pickRow(rows, key);
    if (i >= 0) {
      const { vendor: _keep, ...rest } = patch;
      rows[i] = { ...rows[i], ...rest };
    } else rows.push({ vendor: "", date: key.date, amount: Math.abs(key.amount), currency: key.currency ?? "", status: "pending", file: "", note: "", ...patch });
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(rows, null, 2)}\n`);
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/** For the standalone invoice job: a `write` to `<project>/invoices/manifest.json` is merged into the file already there, so a new run cannot drop earlier entries. Rewrites `event.input.content` in place (Pi's way to change arguments). */
export function manifestMergeExtension(cwd: string): InlineExtension {
  const target = realpathLoose(resolve(cwd, "invoices", "manifest.json"));
  return {
    name: "manifest-merge",
    factory: (pi: ExtensionAPI) => {
      pi.on("tool_call", (event) => {
        const input = event.input as { path?: unknown; content?: unknown };
        if (event.toolName !== "write" || typeof input.path !== "string" || typeof input.content !== "string") return undefined;
        if (/^[~@]/.test(input.path) || realpathLoose(resolve(cwd, input.path)) !== target) return undefined;
        try {
          input.content = mergeManifest(existsSync(target) ? readFileSync(target, "utf8") : undefined, input.content);
        } catch {
          // Leave the write as it is.
        }
        return undefined;
      });
    },
  };
}
