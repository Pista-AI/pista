import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const MAX_READ_BYTES = 1_000_000;
/** The only folder the UI may ask the OS to show. */
export const INVOICES_DIR = "invoices";

/** Real path of `path`: the deepest existing ancestor is resolved through symlinks and the missing rest is appended. */
function realpathLoose(path: string): string {
  let existing = path;
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    rest.unshift(basename(existing));
    existing = parent;
  }
  return join(realpathSync(existing), ...rest);
}

function isInside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\") && !isAbsolute(rel);
}

/** Resolves `relPath` inside `root`, following symlinks (also for a path that does not exist yet); throws when the result leaves the project folder. */
export function resolveInProject(root: string, relPath: string): string {
  if (isAbsolute(relPath)) throw new Error("Path must be relative to the project folder");
  const base = realpathSync(root);
  const real = realpathLoose(resolve(base, relPath));
  if (!isInside(base, real)) throw new Error("Path is outside the project folder");
  return real;
}

/** True when `path` (absolute, or relative to the project) lies under the project's `invoices/` folder (or `folder`), with symlinks resolved. */
export function isInvoicesPath(root: string, path: string, folder: string = INVOICES_DIR): boolean {
  try {
    const base = realpathSync(root);
    const dir = realpathLoose(join(base, folder));
    return isInside(base, dir) && isInside(dir, realpathLoose(resolve(base, path)));
  } catch {
    return false;
  }
}

const PASSWORD_EXPORT_NAME = /^(chrome )?passwords?\b.*\.csv$|^logins?\.csv$|bitwarden.*\.(csv|json)$|1password.*\.(csv|1pux)$/i;
export const PASSWORD_EXPORT_MESSAGE = "That looks like a password export. Pista does not read those.";

/** Defense in depth: password exports are imported by the desktop app only, never read by the host or the model. */
export function isPasswordExportName(path: string): boolean {
  return PASSWORD_EXPORT_NAME.test(basename(path));
}

/** Reads a small text file in the project folder; a missing file is `exists: false`, not an error. */
export function readProjectFile(root: string, relPath: string): { exists: boolean; content?: string; modified?: number } {
  const file = resolveInProject(root, relPath);
  if (isPasswordExportName(relPath) || isPasswordExportName(file)) throw new Error(PASSWORD_EXPORT_MESSAGE);
  if (!existsSync(file) || !statSync(file).isFile()) return { exists: false };
  if (statSync(file).size > MAX_READ_BYTES) throw new Error("File is too large to read");
  return { exists: true, content: readFileSync(file, "utf8"), modified: statSync(file).mtimeMs };
}

/** The command that shows `target` in the file manager. It selects the item (`open -R`), so an app bundle or any other file is never launched. */
export function revealCommand(platform: NodeJS.Platform, target: string): [string, string[]] {
  if (platform === "darwin") return ["open", ["-R", target]];
  if (platform === "win32") return ["explorer", [`/select,${target}`]];
  return ["xdg-open", [dirname(target)]];
}

/** Shows the project's `invoices/` folder in the OS file manager. Nothing else can be revealed. */
export function revealProjectInvoices(root: string, launch: (cmd: string, args: string[]) => void = defaultLaunch): void {
  const target = resolveInProject(root, INVOICES_DIR);
  if (!existsSync(target) || !statSync(target).isDirectory()) throw new Error("Nothing to show yet");
  launch(...revealCommand(process.platform, target));
}

function defaultLaunch(cmd: string, args: string[]): void {
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}
