import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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
  return join(realRoot, relative(realRoot, target));
}
