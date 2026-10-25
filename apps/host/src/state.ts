import { closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

/** Name of the system prompt section Pi wraps in `<pista_state>` tags. */
export const STATE_SECTION = "pista_state";
export const TRUNCATION_MARKER = "[… earlier content truncated …]";
export const DEFAULT_STATE_CAP = 8000;

export interface StateFiles {
  plan?: string;
  progress?: string;
  status?: string;
}

const FILE_NAMES: Record<keyof StateFiles, string> = {
  plan: "PLAN.md",
  progress: "PROGRESS.md",
  status: "STATUS.md",
};

const INTRO =
  "Workspace state files in .pista/ (written by you, kept in the prompt across context compaction). Update them as you work.";
const JOINER = "\n\n";

/** Keeps the end of `text` within `budget` characters, cutting at a line boundary under a marker. */
function truncateTop(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const marker = `${TRUNCATION_MARKER}\n`;
  const keep = budget - marker.length;
  if (keep <= 0) return "";
  let tail = text.slice(-keep);
  const nl = tail.indexOf("\n");
  if (nl >= 0 && nl < tail.length - 1) tail = tail.slice(nl + 1);
  return marker + tail;
}

function title(key: keyof StateFiles): string {
  return `${key.toUpperCase()} (.pista/${FILE_NAMES[key]})`;
}

function block(key: keyof StateFiles, body: string | undefined, budget: number): string | undefined {
  const text = body?.trim();
  if (!text) return undefined;
  const heading = `### ${title(key)}\n`;
  const fitted = truncateTop(text, budget - heading.length);
  return fitted ? heading + fitted : undefined;
}

/**
 * The prompt section for the workspace state files, at most `cap` characters (the cap excludes
 * the ~30 character wrapper Pi adds around the section). STATUS comes first and
 * is kept whole when it fits, then PLAN, then PROGRESS; each is cut from the top (newest content wins)
 * with a marker. PLAN never squeezes PROGRESS below half of what STATUS leaves over.
 * Undefined when no file has content.
 */
export function buildStateSection(files: StateFiles, cap = DEFAULT_STATE_CAP): string | undefined {
  if (!files.status?.trim() && !files.plan?.trim() && !files.progress?.trim()) return undefined;

  const parts: string[] = [INTRO];
  let remaining = cap - INTRO.length;
  const take = (key: keyof StateFiles, budget: number) => {
    const text = block(key, files[key], budget);
    if (!text) return;
    parts.push(text);
    remaining -= text.length + JOINER.length;
  };
  const need = (key: keyof StateFiles) => (files[key]?.trim().length ?? 0) + title(key).length + 5;

  take("status", remaining - JOINER.length);
  const planBudget = Math.min(need("plan"), Math.max(Math.floor(remaining / 2), remaining - need("progress")));
  take("plan", Math.min(planBudget, remaining - JOINER.length));
  take("progress", remaining - JOINER.length);

  return parts.length > 1 ? parts.join(JOINER) : undefined;
}

const LARGE_FILE_BYTES = 256 * 1024;
const TAIL_BYTES = 32 * 1024;

/** Reads a state file; files over 256 KB yield only their last 32 KB (from a line boundary). */
function readIfPresent(path: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const { size } = fstatSync(fd);
    if (size <= LARGE_FILE_BYTES) return readFileSync(fd, "utf8");
    const buffer = Buffer.alloc(TAIL_BYTES);
    const read = readSync(fd, buffer, 0, TAIL_BYTES, size - TAIL_BYTES);
    const tail = buffer.toString("utf8", 0, read);
    const nl = tail.indexOf("\n");
    return nl >= 0 ? tail.slice(nl + 1) : tail;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[state] cannot read ${path}: ${(err as Error).message}`);
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function readStateFiles(cwd: string): StateFiles {
  const files: StateFiles = {};
  for (const key of Object.keys(FILE_NAMES) as (keyof StateFiles)[]) {
    const text = readIfPresent(join(cwd, ".pista", FILE_NAMES[key]));
    if (text !== undefined) files[key] = text;
  }
  return files;
}

/**
 * Puts `.pista/{STATUS,PLAN,PROGRESS}.md` into every prompt as the `pista_state` section.
 *
 * Pi rebuilds the prompt sections from scratch for each prompt and diffs them against the system
 * message replayed from the transcript, so the section must be set on every prompt (leaving it out
 * would patch it away). That diff is also the hash gate: unchanged text appends nothing, so the
 * cached prefix stays stable. Compaction stores the latest system message on its entry, so the
 * section survives it; the next prompt re-reads the files and patches anything that changed. Entries
 * from older Pi versions lack that message, in which case the diff against an empty transcript
 * re-adds every section, the Pista addendum included.
 */
export function stateExtension(): InlineExtension {
  return {
    name: "workspace-state",
    factory: (pi: ExtensionAPI) => {
      pi.on("before_agent_start", (event, ctx) => {
        const section = buildStateSection(readStateFiles(ctx.cwd));
        if (section) event.systemPromptOptions.sections[STATE_SECTION] = section;
        else delete event.systemPromptOptions.sections[STATE_SECTION];
      });
    },
  };
}
