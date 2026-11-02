/** Restart policy for the agent host: exponential backoff, a failure counter that resets after a stable run, and a retry cap. */
export const RESPAWN_BASE_MS = 500;
export const RESPAWN_MAX_MS = 8_000;
export const RESPAWN_MAX_FAILURES = 5;
export const RESPAWN_STABLE_MS = 60_000;

export interface RespawnState {
  failures: number;
}

/** Decides what to do after the host exited. `uptimeMs` is how long that run lasted. */
export function nextRespawn(state: RespawnState, uptimeMs: number): { state: RespawnState; delayMs: number | null } {
  const failures = (uptimeMs >= RESPAWN_STABLE_MS ? 0 : state.failures) + 1;
  if (failures > RESPAWN_MAX_FAILURES) return { state: { failures }, delayMs: null };
  return { state: { failures }, delayMs: Math.min(RESPAWN_MAX_MS, RESPAWN_BASE_MS * 2 ** (failures - 1)) };
}
