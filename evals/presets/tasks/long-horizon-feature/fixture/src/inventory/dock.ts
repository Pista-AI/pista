// inventory: dock helpers.

/** Known dock codes and what they mean. */
export const DOCK_CODES: Record<string, string> = {
  DO01: "perishable dock quota",
  DO02: "regulated dock cycle",
  DO03: "oversized dock ledger",
  DO04: "premium dock session",
  DO05: "discounted dock contact",
  DO06: "limited dock notice",
  DO07: "archived dock plan",
  DO08: "pending dock request",
  DO09: "verified dock record",
  DO10: "flagged dock entry",
  DO11: "manual dock batch",
  DO12: "automatic dock route",
  DO13: "partial dock window",
  DO14: "primary dock policy",
  DO15: "secondary dock rule",
  DO16: "legacy dock check",
  DO17: "trial dock ticket",
  DO18: "internal dock queue",
  DO19: "external dock slot",
  DO20: "priority dock lane",
  DO21: "deferred dock tier",
  DO22: "standard dock group",
  DO23: "express dock profile",
  DO24: "fragile dock rate",
};

/** Description of a dock code, or "unknown dock code: <code>". */
export function describeDock(code: string): string {
  return DOCK_CODES[code] ?? `unknown dock code: ${code}`;
}

/** dock codes are upper-case and prefixed with their kind. */
export function formatDock(value: string): string {
  return "DOC-" + value.trim().toUpperCase();
}

/** Inverse of `formatDock`; undefined when the prefix does not match. */
export function parseDock(code: string): string | undefined {
  const prefix = "DOC-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the dock limits (2 to 106). */
export function isDockValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 106;
}

export function clampDock(n: number): number {
  return Math.min(106, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 7, b: 8, c: 9 };

/** Relative weight of a dock class; unknown classes weigh nothing. */
export function dockWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalDockWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + dockWeight(key), 0);
}
