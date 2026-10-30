import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_WALK_FILES = 5000;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);
// Cheap text check by extension; the estimate only needs to be roughly right.
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|otf|mp[34]|mov|wasm|so|dylib|exe|bin|lock)$/i;

async function bytesOf(paths: string[], cwd: string): Promise<number> {
  let total = 0;
  for (const path of paths) {
    if (BINARY.test(path)) continue;
    try {
      const info = await stat(join(cwd, path));
      if (info.isFile() && info.size <= MAX_FILE_BYTES) total += info.size;
    } catch {
      // Listed but gone or unreadable: it does not count.
    }
  }
  return total;
}

async function walk(cwd: string): Promise<string[]> {
  const files: string[] = [];
  const queue = [""];
  while (queue.length && files.length < MAX_WALK_FILES) {
    const dir = queue.shift()!;
    for (const entry of await readdir(join(cwd, dir), { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) queue.push(join(dir, entry.name));
      } else if (entry.isFile() && files.length < MAX_WALK_FILES) files.push(join(dir, entry.name));
    }
  }
  return files;
}

/** Rough token count of the repo at `cwd`: bytes of tracked text files (git ls-files), or of a bounded directory walk without git, over four. */
export async function estimateRepoTokens(cwd: string): Promise<number> {
  let paths: string[];
  try {
    const { stdout } = await run("git", ["ls-files", "-z"], { cwd, maxBuffer: 64 * 1024 * 1024 });
    paths = stdout.split("\0").filter(Boolean);
  } catch {
    paths = await walk(cwd);
  }
  return Math.ceil((await bytesOf(paths, cwd)) / 4);
}
