import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const MAX_READ_BYTES = 1_000_000;

/** Resolves `relPath` inside `root`, following symlinks; throws when the result would leave the project folder. */
export function resolveInProject(root: string, relPath: string): string {
  if (isAbsolute(relPath)) throw new Error("Path must be relative to the project folder");
  const base = realpathSync(root);
  const target = resolve(base, relPath);
  // A path that does not exist yet is checked by its lexical position; one that exists by its real location.
  const real = existsSync(target) ? realpathSync(target) : target;
  const rel = relative(base, real);
  if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) throw new Error("Path is outside the project folder");
  return real;
}

/** Reads a small text file in the project folder; a missing file is `exists: false`, not an error. */
export function readProjectFile(root: string, relPath: string): { exists: boolean; content?: string } {
  const file = resolveInProject(root, relPath);
  if (!existsSync(file) || !statSync(file).isFile()) return { exists: false };
  if (statSync(file).size > MAX_READ_BYTES) throw new Error("File is too large to read");
  return { exists: true, content: readFileSync(file, "utf8") };
}

/** Shows a file or folder of the project in the OS file manager. */
export function revealProjectPath(root: string, relPath: string): void {
  const target = resolveInProject(root, relPath);
  if (!existsSync(target)) throw new Error("Nothing to show yet");
  const isDir = statSync(target).isDirectory();
  const [cmd, args] =
    process.platform === "darwin" ? ["open", isDir ? [target] : ["-R", target]]
    : process.platform === "win32" ? ["explorer", isDir ? [target] : [`/select,${target}`]]
    : ["xdg-open", [isDir ? target : resolve(target, "..")]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}
