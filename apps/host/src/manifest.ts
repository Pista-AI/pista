import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { realpathLoose } from "./project-files.ts";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

type Entry = Record<string, unknown>;

const keyOf = (e: Entry) => {
  const amount = Number(e.amount);
  return `${String(e.vendor ?? "").trim().toLowerCase()}|${String(e.date ?? "").trim()}|${Number.isFinite(amount) ? amount.toFixed(2) : String(e.amount ?? "")}`;
};

function parseArray(raw: string): Entry[] | null {
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.filter((e): e is Entry => Boolean(e) && typeof e === "object" && !Array.isArray(e)) : null;
  } catch {
    return null;
  }
}

/**
 * Merges a freshly written manifest into the one on disk, keyed by vendor, date and amount: the new entry wins field by field
 * (except that a "pending" entry never overwrites the status, file and note of an entry already worked on), and old entries
 * missing from the new array are kept. A missing or malformed old file, or an unreadable new one, leaves the new content as is. Never throws.
 */
export function mergeManifest(oldRaw: string | undefined, newRaw: string): string {
  const next = parseArray(newRaw);
  const old = oldRaw === undefined ? null : parseArray(oldRaw);
  if (!next || !old || old.length === 0) return newRaw;
  const oldByKey = new Map(old.map((e) => [keyOf(e), e]));
  const seen = new Set<string>();
  const merged: Entry[] = next.map((e) => {
    const key = keyOf(e);
    seen.add(key);
    const prev = oldByKey.get(key);
    if (!prev) return e;
    const keepProgress = e.status === "pending" && prev.status !== undefined && prev.status !== "pending";
    return { ...prev, ...e, ...(keepProgress ? { status: prev.status, file: prev.file, note: prev.note } : {}) };
  });
  for (const e of old) if (!seen.has(keyOf(e))) merged.push(e);
  return JSON.stringify(merged, null, 2);
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
