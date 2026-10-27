import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";

/**
 * Spawns `command` in its own process group (not on Windows), so `kill` also reaches what it started.
 * `args` may be empty with `options.shell`, in which case `command` is a shell line.
 */
export function spawnGroup(command: string, args: string[], options: SpawnOptions): { child: ChildProcess; kill: () => void } {
  const child = spawn(command, args, { ...options, detached: process.platform !== "win32" });
  const kill = () => {
    try {
      if (process.platform === "win32" || !child.pid) child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  };
  return { child, kill };
}
