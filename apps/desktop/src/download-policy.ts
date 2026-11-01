import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

/** Fixed refusal text: it never echoes the requested path. */
export const DOWNLOAD_REFUSED = "download refused: the save location is not allowed";

/** Extensions a page-supplied file must not be saved with, because opening them can run code. */
const BLOCKED_EXTENSIONS = new Set([".app", ".lnk", ".vbs", ".vbe", ".wsf", ".wsh", ".hta", ".scr", ".com", ".pif", ".reg", ".py", ".rb", ".pl", ".php", ".jnlp", ".desktop", ".workflow", ".action", ".terminal", ".webloc", ".url", ".iso", ".appimage", ".docm", ".xlsm", ".pptm", ".cpl", ".msc", ".inf", ".sys", ".drv", ".exe", ".dll", ".so", ".dylib", ".sh", ".command", ".bat", ".cmd", ".ps1", ".scpt", ".js", ".mjs", ".cjs", ".jar", ".msi", ".pkg", ".dmg"]);

export interface DownloadPolicyContext {
  home: string;
  /** Folders a download root may not be or contain, but may sit inside (a project can live under the app data folder). */
  protectedDirs: string[];
  /** Folders a download root may not be, contain or sit inside (credentials and OS-managed app data). */
  sealedDirs: string[];
  /** Defaults to process.platform; darwin and win32 compare paths case-insensitively. */
  platform?: NodeJS.Platform;
}

/** Folder names no download may be saved under, besides every name that starts with a dot (.git, .vscode, .husky, ...). */
const TOOLING_SEGMENTS = new Set(["node_modules"]);
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Folders a download root may not be or contain. */
export function protectedDirsFor(opts: { userData: string; clientHome: string }): string[] {
  return [opts.userData, opts.clientHome];
}

/** Folders nothing may be saved into, at any depth. */
export function sealedDirsFor(opts: { home: string; clientHome?: string; env?: Record<string, string | undefined> }): string[] {
  const { home, env = {} } = opts;
  return [
    // Pi's auth, sessions and MCP config. The rest of PISTA_HOME stays usable (the default Workspace project lives there).
    path.join(home, ".pista", "pi"),
    ...(opts.clientHome ? [path.join(opts.clientHome, "pi")] : []),
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
      return path.join(realpathSync.native(current), ...tail.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(p);
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/** Case-insensitive on darwin and win32 (this also folds a Windows drive letter). */
const folder = (platform: NodeJS.Platform) => (p: string) => (platform === "win32" || platform === "darwin" ? p.toLowerCase() : p);

/**
 * Decides whether the armed download may be saved at `requested` for the project folder `root`.
 * Returns the resolved path to save at, or undefined when refused. Called when arming and again right before the file is written.
 */
export function confineDownload(requested: unknown, root: unknown, ctx: DownloadPolicyContext): string | undefined {
  if (typeof requested !== "string" || typeof root !== "string") return undefined;
  if (!path.isAbsolute(requested) || !path.isAbsolute(root)) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(requested) || /[\u0000-\u001f\u007f]/.test(root)) return undefined;
  const fold = folder(ctx.platform ?? process.platform);
  const within = (parent: string, child: string) => {
    const a = fold(parent);
    const b = fold(child);
    return b === a || b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);
  };
  try {
    if (!statSync(root).isDirectory()) return undefined;
    const realRoot = realpathLoose(root);
    const target = realpathLoose(requested);
    if (fold(target) === fold(realRoot) || !within(realRoot, target)) return undefined;

    // The root may not be or contain the home folder or a protected folder, nor sit inside a sealed one.
    if (within(realRoot, realpathLoose(ctx.home))) return undefined;
    if (ctx.protectedDirs.map(realpathLoose).some((dir) => within(realRoot, dir))) return undefined;
    if (ctx.sealedDirs.map(realpathLoose).some((dir) => within(dir, realRoot) || within(realRoot, dir))) return undefined;

    // Every segment below the root: no hidden or tooling folders, nothing Windows would reinterpret.
    for (const segment of path.relative(realRoot, target).split(path.sep)) {
      if (!segment || segment.startsWith(".") || TOOLING_SEGMENTS.has(segment.toLowerCase())) return undefined;
      if (/[. ]$/.test(segment) || segment.includes(":") || WINDOWS_RESERVED.test(segment.split(".")[0]!.trim())) return undefined;
    }
    if (BLOCKED_EXTENSIONS.has(path.extname(path.basename(target).trim()).toLowerCase())) return undefined;

    // An existing regular file may be replaced (re-downloads); a link at the target could lead anywhere.
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
