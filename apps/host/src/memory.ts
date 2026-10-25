import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MemorySnapshot } from "@pista/protocol";
import { piMemoryDir } from "./pi-env.ts";

// Threads in Pista have no explicit "end", and the host disposes sessions on
// restarts and config changes. pi-memory's LLM exit summary would run on each of those,
// so it is off unless the user opts in. Agents still write memory explicitly, and
// pi-memory captures a handoff before compaction.
process.env.PI_MEMORY_EXIT_SUMMARY ??= "0";

/** Agent memory lives at `$PISTA_HOME/pi/memory` unless PI_MEMORY_DIR is set (see pi-env.ts). */
export function memoryDir(): string {
  return piMemoryDir();
}

const read = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

export function readMemory(enabled: boolean): MemorySnapshot {
  const dir = memoryDir();
  let dailyFiles: string[] = [];
  try {
    dailyFiles = readdirSync(join(dir, "daily"))
      .filter((f) => f.endsWith(".md"))
      .sort()
      .slice(-3)
      .reverse();
  } catch {
    /* no daily logs yet */
  }
  return {
    enabled,
    dir,
    longTerm: read(join(dir, "MEMORY.md")),
    scratchpad: read(join(dir, "SCRATCHPAD.md")),
    daily: dailyFiles.map((f) => ({ date: f.replace(/\.md$/, ""), content: read(join(dir, "daily", f)) })),
  };
}
