import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

/** Fixed refusal text: it never echoes the requested path. */
export const DOWNLOAD_REFUSED = "download refused: the save location is not allowed";

/** Extensions a page-supplied file must not be saved with, because opening them can run code. */
const BLOCKED_EXTENSIONS = new Set([".app", ".exe", ".dll", ".so", ".dylib", ".sh", ".command", ".bat", ".cmd", ".ps1", ".scpt", ".js", ".mjs", ".cjs", ".jar", ".msi", ".pkg", ".dmg"]);

export interface DownloadPolicyContext {
  home: string;
  /** Folders a download root may not be or contain, but may sit inside (a project can live under the app data folder). */
  protectedDirs: string[];
  /** Folders a download root may not be, contain or sit inside (credentials and OS-managed app data). */
  sealedDirs: string[];
}

/** Folders a download root may not be or contain. */
export function protectedDirsFor(opts: { userData: string; clientHome: string }): string[] {
  return [opts.userData, opts.clientHome];
}

/** Folders nothing may be saved into, at any depth. */
export function sealedDirsFor(opts: { home: string; env?: Record<string, string | undefined> }): string[] {
  const { home, env = {} } = opts;
  return [
    path.join(home, ".pista"),
    path.join(home, ".pi"),
    path.join(home, ".ssh"),
    path.join(home, "Library"),
    path.join(home, ".config"),
    ...[env.APPDATA, env.LOCALAPPDATA].filter((p): p is string => Boolean(p)),
  ];
}

/** realpath of the deepest existing ancestor, with the not-yet-existing tail appended. */
function realpathLoose(p: string): string {
  const tail: string[] = [];
  let current = path.resolve(p);
  for (;;) {
    try {
      return path.join(realpathSync(current), ...tail.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(p);
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

const within = (parent: string, child: string) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

/**
 * Decides whether the armed download may be saved at `requested` for the project folder `root`.
 * Returns the resolved path to save at, or undefined when refused.
 */
export function confineDownload(requested: unknown, root: unknown, ctx: DownloadPolicyContext): string | undefined {
  if (typeof requested !== "string" || typeof root !== "string") return undefined;
  if (!path.isAbsolute(requested) || !path.isAbsolute(root)) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(requested) || /[\u0000-\u001f\u007f]/.test(root)) return undefined;
  try {
    if (!statSync(root).isDirectory()) return undefined;
    const realRoot = realpathLoose(root);
    const target = realpathLoose(requested);
    if (target === realRoot || !within(realRoot, target)) return undefined;

    // The root may not be or contain the home folder or a protected folder, nor sit inside a sealed one.
    if (within(realRoot, realpathLoose(ctx.home))) return undefined;
    if (ctx.protectedDirs.map(realpathLoose).some((dir) => within(realRoot, dir))) return undefined;
    if (ctx.sealedDirs.map(realpathLoose).some((dir) => within(dir, realRoot) || within(realRoot, dir))) return undefined;

    const name = path.basename(path.resolve(requested));
    if (!name || name.startsWith(".") || name.includes("..")) return undefined;
    if (BLOCKED_EXTENSIONS.has(path.extname(name).toLowerCase())) return undefined;

    try {
      if (lstatSync(path.resolve(requested)).isSymbolicLink()) return undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return undefined;
    }
    return target;
  } catch {
    return undefined;
  }
}
