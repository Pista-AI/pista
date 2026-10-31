// notifications: window helpers.

/** Known window codes and what they mean. */
export const WINDOW_CODES: Record<string, string> = {
  WI01: "archived window slot",
  WI02: "pending window lane",
  WI03: "verified window tier",
  WI04: "flagged window group",
  WI05: "manual window profile",
  WI06: "automatic window rate",
  WI07: "partial window cap",
  WI08: "primary window quota",
  WI09: "secondary window cycle",
  WI10: "legacy window ledger",
  WI11: "trial window session",
  WI12: "internal window contact",
  WI13: "external window notice",
  WI14: "priority window plan",
  WI15: "deferred window request",
  WI16: "standard window record",
  WI17: "express window entry",
  WI18: "fragile window batch",
  WI19: "bulky window route",
  WI20: "seasonal window window",
  WI21: "returnable window policy",
  WI22: "perishable window rule",
  WI23: "regulated window check",
  WI24: "oversized window ticket",
};

/** Description of a window code, or "unknown window code: <code>". */
export function describeWindow(code: string): string {
  return WINDOW_CODES[code] ?? `unknown window code: ${code}`;
}

/** window codes are upper-case and prefixed with their kind. */
export function formatWindow(value: string): string {
  return "WIN-" + value.trim().toUpperCase();
}

/** Inverse of `formatWindow`; undefined when the prefix does not match. */
export function parseWindow(code: string): string | undefined {
  const prefix = "WIN-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the window limits (0 to 112). */
export function isWindowValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 112;
}

export function clampWindow(n: number): number {
  return Math.min(112, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 13, b: 14, c: 15 };

/** Relative weight of a window class; unknown classes weigh nothing. */
export function windowWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalWindowWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + windowWeight(key), 0);
}
