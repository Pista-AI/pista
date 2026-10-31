import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

/** Longest text taken from one file, and from all files of one brief. */
export const PREREAD_FILE_CHARS = 12_000;
export const PREREAD_TOTAL_CHARS = 40_000;
const DIR_ENTRIES = 200;

export const PREREAD_HEADING = "## Files read by the harness";
export const PREREAD_RULE = "Start from the files above; do not list or grep the repository before you have read them.";

const inside = (cwd: string, path: string) => {
  const rel = relative(cwd, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** One fenced block per readable pointer. Paths outside `cwd`, missing paths and binary files are skipped. */
async function block(cwd: string, pointer: string, budget: number): Promise<string | undefined> {
  const path = resolve(cwd, pointer.trim());
  if (!pointer.trim() || !inside(cwd, path)) return undefined;
  const label = relative(cwd, path) || ".";
  try {
    const info = await stat(path);
    if (info.isDirectory()) {
      const entries = (await readdir(path, { withFileTypes: true })).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
      const shown = entries.slice(0, DIR_ENTRIES);
      const more = entries.length > shown.length ? `\n[${entries.length - shown.length} more entries]` : "";
      return `\`\`\`path=${label}/ (directory)\n${shown.join("\n")}${more}\n\`\`\``;
    }
    if (!info.isFile()) return undefined;
    const buf = await readFile(path);
    if (buf.subarray(0, 8000).includes(0)) return undefined;
    const text = buf.toString("utf8");
    const max = Math.min(PREREAD_FILE_CHARS, budget);
    if (max <= 0) return undefined;
    const body = text.length > max ? `${text.slice(0, max)}\n[truncated: ${text.length - max} more characters]` : text;
    return `\`\`\`path=${label}\n${body}\n\`\`\``;
  } catch {
    return undefined;
  }
}

/** The section appended to a child brief with the contents of the slice's pointers; undefined when nothing could be read. */
export async function prereadSection(cwd: string, pointers: string[]): Promise<string | undefined> {
  const blocks: string[] = [];
  let budget = PREREAD_TOTAL_CHARS;
  for (const pointer of pointers) {
    const b = await block(cwd, pointer, budget);
    if (!b) continue;
    blocks.push(b);
    budget -= b.length;
  }
  return blocks.length ? `${PREREAD_HEADING}\n${blocks.join("\n\n")}\n\n${PREREAD_RULE}` : undefined;
}
