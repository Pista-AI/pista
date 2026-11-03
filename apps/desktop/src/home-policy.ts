import { realpathSync } from "node:fs";
import path from "node:path";

/** Real path of `p`; when it does not exist yet, the real path of its nearest existing parent plus the missing tail. */
function resolveReal(p: string): string {
  let current = path.resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync.native(current), ...tail.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...tail.reverse());
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/** True when `home` is the default credential home, through symlinks and (on macOS and Windows) differences in case. */
export function isDefaultHome(home: string, defaultHome: string, platform: NodeJS.Platform = process.platform): boolean {
  if (!home) return true; // An empty PISTA_HOME means unset.
  const fold =(p: string) => (platform === "darwin" || platform === "win32" ? p.toLowerCase() : p);
  return fold(resolveReal(home)) === fold(resolveReal(defaultHome));
}
