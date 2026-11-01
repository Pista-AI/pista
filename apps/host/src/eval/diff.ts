// Diff of an agent workspace against its fixture, for the preset eval (run-one.ts).
import { execFile } from "node:child_process";
import { dirname, relative, sep } from "node:path";
import { DIFF_CHARS, type DiffStats } from "./presets.ts";

const DIFF_TIMEOUT_MS = 30_000;
export const TRUNCATED = "\n[diff truncated]\n";
/** Harness and dependency dirs that are not the agent's work. */
const IGNORED = /\/(\.pista|\.codegraph|node_modules|\.git)\//;

function commonParent(a: string, b: string): string {
  let dir = dirname(a);
  while (relative(dir, b).startsWith("..")) dir = dirname(dir);
  return dir;
}

/**
 * `git diff --no-index` run from a common parent with relative paths, so no absolute temp path can leak into the
 * output (new files print the work path on both sides, deleted ones the fixture path). Exit 1 means "differs".
 * Rejects on a spawn error, a timeout or any other exit code.
 */
export function workspaceDiff(fixture: string, work: string): Promise<{ diff: string; stats: DiffStats }> {
  const cwd = commonParent(fixture, work);
  const rel = (p: string) => relative(cwd, p).split(sep).join("/");
  const [from, to] = [rel(fixture), rel(work)];
  return new Promise((resolve, reject) => {
    execFile("git", ["-c", "core.quotepath=false", "diff", "--no-index", "--no-color", "--", from, to], { cwd, maxBuffer: 64 * 1024 * 1024, timeout: DIFF_TIMEOUT_MS }, (error, stdout) => {
      if (error && (error as { code?: unknown }).code !== 1) return reject(error);
      const sections = stdout.split(/^(?=diff --git )/m).filter((s) => s.startsWith("diff --git ") && !IGNORED.test(s.split("\n", 1)[0]!));
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const full = sections.join("").replace(new RegExp(`\\b([ab])/(?:${esc(from)}|${esc(to)})/`, "g"), "$1/");
      const stats = { files: sections.length, added: 0, removed: 0 };
      for (const line of full.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) stats.added++;
        else if (line.startsWith("-") && !line.startsWith("---")) stats.removed++;
      }
      resolve({ diff: full.length > DIFF_CHARS ? full.slice(0, DIFF_CHARS) + TRUNCATED : full, stats });
    });
  });
}
