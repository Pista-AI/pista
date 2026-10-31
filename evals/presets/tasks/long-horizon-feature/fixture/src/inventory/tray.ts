// inventory: tray helpers.

/** Known tray codes and what they mean. */
export const TRAY_CODES: Record<string, string> = {
  TR01: "pending tray ledger",
  TR02: "verified tray session",
  TR03: "flagged tray contact",
  TR04: "manual tray notice",
  TR05: "automatic tray plan",
  TR06: "partial tray request",
  TR07: "primary tray record",
  TR08: "secondary tray entry",
  TR09: "legacy tray batch",
  TR10: "trial tray route",
  TR11: "internal tray window",
  TR12: "external tray policy",
  TR13: "priority tray rule",
  TR14: "deferred tray check",
  TR15: "standard tray ticket",
  TR16: "express tray queue",
  TR17: "fragile tray slot",
  TR18: "bulky tray lane",
  TR19: "seasonal tray tier",
  TR20: "returnable tray group",
  TR21: "perishable tray profile",
  TR22: "regulated tray rate",
  TR23: "oversized tray cap",
  TR24: "premium tray quota",
};

/** Description of a tray code, or "unknown tray code: <code>". */
export function describeTray(code: string): string {
  return TRAY_CODES[code] ?? `unknown tray code: ${code}`;
}

/** "1 tray" or "3 trays". */
export function trayLabel(count: number): string {
  return count === 1 ? "1 tray" : `${count} trays`;
}

export function traySummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** tray codes are upper-case and prefixed with their kind. */
export function formatTray(value: string): string {
  return "TRA-" + value.trim().toUpperCase();
}

/** Inverse of `formatTray`; undefined when the prefix does not match. */
export function parseTray(code: string): string | undefined {
  const prefix = "TRA-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the tray limits (0 to 140). */
export function isTrayValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 140;
}

export function clampTray(n: number): number {
  return Math.min(140, Math.max(0, Math.trunc(n)));
}
