import { closeSync, existsSync, lstatSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync } from "node:fs";
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

/** A download that is a web page, not a file: an error page or a sign-in page saved under an invoice's name. */
export class NotAnInvoice extends Error {
  constructor(source: "url" | "ref" = "url") {
    super(
      source === "url"
        ? "That URL returned a web page, not a file. Nothing was saved. Click the page's download control by ref instead of retyping a URL."
        : "That click opened a web page, not a file. Nothing was saved. Check you picked the invoice's download control.",
    );
  }
}

/** Whether a response is a web page: by its content type, or, when the type says nothing, by its first bytes (after a byte order mark). */
export function isWebPage(contentType: string | undefined, head: Buffer): boolean {
  const ct = contentType?.toLowerCase() ?? "";
  if (/\b(text\/html|application\/xhtml)/.test(ct)) return true;
  if (ct && !/^(application|binary)\/octet-stream\b/.test(ct)) return false;
  let text: string;
  if (head[0] === 0xff && head[1] === 0xfe) text = head.subarray(2).toString("utf16le");
  else if (head[0] === 0xfe && head[1] === 0xff) text = Buffer.from(head.subarray(2)).swap16().toString("utf16le");
  else text = head.subarray(head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0).toString("latin1");
  return /^\s*(<\?xml[^>]*>\s*|<!--[\s\S]*?-->\s*)*(<!doctype\s+html|<html[\s>])/i.test(text);
}

/** The first bytes of a file, or empty when it cannot be read. */
export function readHead(file: string): Buffer {
  try {
    const fd = openSync(file, "r");
    try {
      const buf = Buffer.alloc(512);
      return buf.subarray(0, readSync(fd, buf, 0, 512, 0));
    } finally {
      closeSync(fd);
    }
  } catch {
    return Buffer.alloc(0);
  }
}

/** `validate` for saveDownload: refuses a web page (see isWebPage). */
export const rejectWebPage = (source: "url" | "ref") => (file: string, got: { contentType?: string }): void => {
  if (isWebPage(got.contentType, readHead(file))) throw new NotAnInvoice(source);
};

/**
 * Saves one download to `path` under `root` (confined, see confineToFolder). An existing file is replaced only with `overwrite` or
 * when it is clearly a failed earlier download; the new file is written beside it and renamed over it, so a failed download never destroys it.
 * `validate` sees the new file before it replaces anything; when it throws, the new file is removed and the old one stays.
 */
export async function saveDownload(
  d: BrowserDriver,
  to: { root: string; path: string; overwrite?: boolean; validate?: (file: string, saved: { bytes: number; contentType?: string; urlChain?: string[] }) => void },
  source: { url?: string; trigger?: () => Promise<unknown>; signal?: AbortSignal },
) {
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
    try {
      to.validate?.(dest, saved);
    } catch (error) {
      rmSync(dest, { force: true });
      throw error;
    }
    if (replaced) renameSync(dest, target);
    return { ...saved, replaced };
  } catch (error) {
    if (replaced) rmSync(dest, { force: true });
    throw error;
  }
}
