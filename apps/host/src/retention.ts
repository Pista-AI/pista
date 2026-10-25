// Retention purge for the managed policy's `retention` block. Deletes only plain files that really sit under an
// allowed root (Pi's sessions dir for session files, `$PISTA_HOME/browser-traces` for traces) and end in .jsonl: symlinks are never followed or removed, and nothing is logged but counts.
import { lstatSync, readdirSync, realpathSync, unlinkSync } from "node:fs";
import { join, sep } from "node:path";
import type { ManagedPolicy } from "@pista/protocol";
import type { AuditSink } from "./audit.ts";

const DAY_MS = 86_400_000;
export const PURGE_INTERVAL_MS = 4 * 3_600_000;

type Retention = NonNullable<ManagedPolicy["retention"]>;

export interface PurgeStats {
  threads: number;
  traces: number;
  /** Files that were not deleted because they failed a safety check or could not be removed. */
  skipped: number;
}

/** True when `file` is a regular `.jsonl` file (not a link) whose real path lies inside `root`'s real path. */
export function safeToDelete(file: string, root: string): boolean {
  try {
    if (!file.endsWith(".jsonl") || !lstatSync(file).isFile()) return false;
    return realpathSync(file).startsWith(realpathSync(root) + sep);
  } catch {
    return false;
  }
}

/** Deletes one `.jsonl` file when it is safe to. Returns whether it was removed. */
export function deleteFile(file: string, root: string): boolean {
  if (!safeToDelete(file, root)) return false;
  try {
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

/** Deletes `*.jsonl` browser traces in `<home>/browser-traces` last modified before `cutoff`, counting into `stats`. */
export function purgeTraces(home: string, cutoff: number, stats: PurgeStats): void {
  const dir = join(home, "browser-traces");
  let names: string[] = [];
  try {
    if (!realpathSync(dir).startsWith(realpathSync(home) + sep)) return; // a traces folder linked out of the home is not ours
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const file = join(dir, name);
    try {
      if (lstatSync(file).mtimeMs >= cutoff) continue;
    } catch {
      continue;
    }
    if (deleteFile(file, dir)) stats.traces++;
    else stats.skipped++;
  }
}

export interface PurgeTarget {
  /** Deletes idle threads last active before `cutoff`, counting into `stats`. Running and open threads are kept. */
  purgeThreads(cutoff: number, stats: PurgeStats): Promise<void>;
}

export async function runPurge(retention: Retention, target: PurgeTarget, home: string, audit: AuditSink, now = Date.now()): Promise<PurgeStats> {
  const stats: PurgeStats = { threads: 0, traces: 0, skipped: 0 };
  if (retention.sessionDays) {
    try {
      await target.purgeThreads(now - retention.sessionDays * DAY_MS, stats);
    } catch (error) {
      console.error(`[pista-host] retention thread purge failed: ${(error as Error).message}`);
    }
  }
  if (retention.traceDays) {
    try {
      purgeTraces(home, now - retention.traceDays * DAY_MS, stats);
    } catch (error) {
      console.error(`[pista-host] retention trace purge failed: ${(error as Error).message}`);
    }
  }
  if (stats.threads || stats.traces || stats.skipped) {
    console.log(`[pista-host] retention purge removed ${stats.threads} threads, ${stats.traces} trace files, skipped ${stats.skipped} files`);
    try {
      audit.emit("pista.retention.purge", { "purge.threads": stats.threads, "purge.traces": stats.traces, "purge.skipped": stats.skipped });
    } catch {
      // auditing must not break the purge
    }
  }
  return stats;
}

/** Runs the purge at startup (unless `purgeOnStartup` is false), then every few hours. Runs never overlap; the timer never keeps the process alive. */
export function startRetention(retention: Retention | undefined, target: PurgeTarget, home: string, audit: AuditSink): void {
  if (!retention || (!retention.sessionDays && !retention.traceDays)) return;
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    runPurge(retention, target, home, audit)
      .catch((error) => console.error(`[pista-host] retention purge failed: ${(error as Error).message}`))
      .finally(() => (running = false));
  };
  if (retention.purgeOnStartup !== false) run();
  setInterval(run, PURGE_INTERVAL_MS).unref();
}
