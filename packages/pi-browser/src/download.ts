import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { runPageAction, type Approve } from "./actions.ts";
import type { BrowserDriver } from "./driver.ts";
import { scripts } from "./page-scripts.ts";

/** Resolves `requested` under `root` (the project folder) or throws. The deepest existing parent is resolved with realpath, so a symlink cannot lead out. */
export function confineToFolder(root: string, requested: string): string {
  if (!requested.trim()) throw new Error("path is required");
  if (isAbsolute(requested)) throw new Error("path must be relative to the project folder");
  const realRoot = realpathSync(root);
  const target = resolve(realRoot, requested);
  const inside = (p: string) => p === realRoot || p.startsWith(realRoot + sep);
  if (target === realRoot || !inside(target)) throw new Error("path must stay inside the project folder");
  // Walk up to the nearest existing ancestor: directories that do not exist yet cannot be symlinks.
  let ancestor = dirname(target);
  for (;;) {
    try {
      if (!inside(realpathSync(ancestor))) throw new Error("path must stay inside the project folder (a parent folder is a link that leads outside)");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      ancestor = dirname(ancestor);
    }
  }
  try {
    if (lstatSync(target).isSymbolicLink()) throw new Error("path must not be a symbolic link");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return join(realRoot, relative(realRoot, target));
}

const BROKEN_MAX_BYTES = 4096;

/** Sibling name used while replacing a file. No leading dot: the desktop pane refuses dot-prefixed path segments. */
export function tempDownloadPath(target: string): string {
  return join(dirname(target), `${basename(target)}.${process.pid}.part`);
}

/** True when the file at `file` is clearly a failed earlier download: empty, or small and not what its extension promises (no %PDF header, or an HTML error page). */
export function looksLikeFailedDownload(file: string): boolean {
  const info = lstatSync(file);
  if (!info.isFile()) throw new Error("the existing path is not a regular file (a folder or link); choose another filename");
  if (info.size === 0) return true;
  if (info.size > BROKEN_MAX_BYTES) return false;
  const head = readFileSync(file).subarray(0, 1024).toString("latin1").toLowerCase();
  const ext = extname(file).toLowerCase();
  if (ext === ".pdf") return !head.includes("%pdf");
  if (ext === ".html" || ext === ".htm") return false;
  return /^\s*(<!doctype html|<html|<head|<body)/.test(head);
}

/** How to get the file behind a snapshot ref: a link is downloaded by address (a PDF link would open in the inline viewer), anything else is clicked while the browser waits for the download. */
export async function refDownloadSource(d: BrowserDriver, ref: string, approve: Approve): Promise<{ url: string } | { trigger: () => Promise<void> }> {
  const href = String(await d.evaluate(scripts.href(ref)).catch(() => ""));
  if (href) return { url: href };
  return {
    trigger: async () => {
      const result = await runPageAction(d, { action: "click", target: ref }, approve);
      if (result.note && /^Stopped|not found|error/i.test(result.note)) throw new Error(`download failed: ${result.note}`);
    },
  };
}

/**
 * Saves one download to `path` under `root` (confined, see confineToFolder). An existing file is replaced only with `overwrite` or
 * when it is clearly a failed earlier download; the new file is written beside it and renamed over it, so a failed download never destroys it.
 */
export async function saveDownload(d: BrowserDriver, to: { root: string; path: string; overwrite?: boolean }, source: { url?: string; trigger?: () => Promise<unknown> }) {
  const target = confineToFolder(to.root, to.path);
  let replaced = "";
  if (existsSync(target)) {
    if (to.overwrite) replaced = " (replaced the existing file)";
    else if (looksLikeFailedDownload(target)) replaced = " (replaced a broken file from an earlier failed download)";
    else throw new Error(`${to.path} already exists. Pass overwrite: true to replace it, or choose another filename.`);
  }
  if (!d.download) throw new Error("Downloads are not supported with this browser driver (the cdp driver cannot save downloads).");
  const dest = replaced ? tempDownloadPath(target) : target;
  try {
    const saved = await d.download({ path: dest, ...source });
    if (replaced) renameSync(dest, target);
    return { ...saved, replaced, remove: () => rmSync(target, { force: true }) };
  } catch (error) {
    if (replaced) rmSync(dest, { force: true });
    throw error;
  }
}
