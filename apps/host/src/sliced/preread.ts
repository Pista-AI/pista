import { open, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

/** Longest text taken from one file, and from all files of one brief (the whole section, fences included). */
export const PREREAD_FILE_CHARS = 12_000;
export const PREREAD_TOTAL_CHARS = 40_000;
const DIR_ENTRIES = 200;
/** Room kept for the heading, the closing rule and the omitted-pointers line. */
const SECTION_RESERVE = 400;
const MARKER_RESERVE = 80;

export const PREREAD_HEADING = "## Files read by the harness";
export const PREREAD_RULE = "Start from the files above; do not list or grep the repository before you have read them.";

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const fence = (header: string, body: string) => `\`\`\`${header}\n${body}\n\`\`\``;

/** One fenced block of at most `budget` characters, or undefined when the pointer is unreadable, binary, outside `cwd` (symlinks resolved) or does not fit. `null` means it was readable but the budget is spent. */
async function block(cwd: string, realCwd: string, pointer: string, budget: number): Promise<string | undefined | null> {
  const wanted = pointer.trim();
  if (!wanted) return undefined;
  const path = resolve(cwd, wanted);
  if (!inside(cwd, path)) return undefined;
  const label = relative(cwd, path) || ".";
  try {
    const real = await realpath(path);
    if (!inside(realCwd, real)) return undefined;
    const info = await stat(real);
    if (info.isDirectory()) {
      const header = `path=${label}/ (directory)`;
      const room = Math.min(PREREAD_FILE_CHARS, budget - header.length - 8 - MARKER_RESERVE);
      if (room <= 0) return null;
      const entries = (await readdir(real, { withFileTypes: true })).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
      const shown: string[] = [];
      let used = 0;
      for (const e of entries.slice(0, DIR_ENTRIES)) {
        if (used + e.length + 1 > room) break;
        shown.push(e);
        used += e.length + 1;
      }
      const more = entries.length > shown.length ? `\n[${entries.length - shown.length} more entries]` : "";
      return fence(header, `${shown.join("\n")}${more}`);
    }
    if (!info.isFile()) return undefined;
    const header = `path=${label}`;
    const room = Math.min(PREREAD_FILE_CHARS, budget - header.length - 8 - MARKER_RESERVE);
    if (room <= 0) return null;
    // Read only what can be shown: at most 4 bytes per character, never the whole file.
    const want = Math.min(info.size, room * 4 + 4);
    const handle = await open(real, "r");
    let buf: Buffer;
    try {
      buf = Buffer.alloc(want);
      const { bytesRead } = await handle.read(buf, 0, want, 0);
      buf = buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
    if (buf.subarray(0, 8000).includes(0)) return undefined;
    const text = buf.toString("utf8");
    const cut = text.length > room || buf.length < info.size;
    const body = cut ? `${text.slice(0, room).replace(/[\ud800-\udbff]$/, "")}\n[truncated: file is ${info.size} bytes]` : text;
    return fence(header, body);
  } catch {
    return undefined;
  }
}

/** The section appended to a child brief with the contents of the slice's pointers; undefined when nothing could be read. */
export async function prereadSection(cwd: string, pointers: string[]): Promise<string | undefined> {
  const blocks: string[] = [];
  let budget = PREREAD_TOTAL_CHARS - SECTION_RESERVE;
  let omitted = 0;
  let realCwd: string;
  try {
    realCwd = await realpath(cwd);
  } catch {
    return undefined;
  }
  for (const pointer of pointers) {
    if (!pointer.trim()) continue;
    const b = await block(cwd, realCwd, pointer, budget);
    if (b) {
      blocks.push(b);
      budget -= b.length + 2;
    } else if (b === null) omitted++;
  }
  if (!blocks.length) return undefined;
  const note = omitted ? `\n\n[${omitted} pointers omitted: budget]` : "";
  return `${PREREAD_HEADING}\n${blocks.join("\n\n")}${note}\n\n${PREREAD_RULE}`;
}
