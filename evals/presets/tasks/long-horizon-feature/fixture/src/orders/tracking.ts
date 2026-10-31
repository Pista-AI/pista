// orders: tracking helpers.

/** Known tracking codes and what they mean. */
export const TRACKING_CODES: Record<string, string> = {
  TR01: "premium tracking entry",
  TR02: "discounted tracking batch",
  TR03: "limited tracking route",
  TR04: "archived tracking window",
  TR05: "pending tracking policy",
  TR06: "verified tracking rule",
  TR07: "flagged tracking check",
  TR08: "manual tracking ticket",
  TR09: "automatic tracking queue",
  TR10: "partial tracking slot",
  TR11: "primary tracking lane",
  TR12: "secondary tracking tier",
  TR13: "legacy tracking group",
  TR14: "trial tracking profile",
  TR15: "internal tracking rate",
  TR16: "external tracking cap",
  TR17: "priority tracking quota",
  TR18: "deferred tracking cycle",
  TR19: "standard tracking ledger",
  TR20: "express tracking session",
  TR21: "fragile tracking contact",
  TR22: "bulky tracking notice",
  TR23: "seasonal tracking plan",
  TR24: "returnable tracking request",
};

/** Description of a tracking code, or "unknown tracking code: <code>". */
export function describeTracking(code: string): string {
  return TRACKING_CODES[code] ?? `unknown tracking code: ${code}`;
}

/** tracking codes are upper-case and prefixed with their kind. */
export function formatTracking(value: string): string {
  return "TRA-" + value.trim().toUpperCase();
}

/** Inverse of `formatTracking`; undefined when the prefix does not match. */
export function parseTracking(code: string): string | undefined {
  const prefix = "TRA-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the tracking limits (1 to 109). */
export function isTrackingValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 109;
}

export function clampTracking(n: number): number {
  return Math.min(109, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 10, b: 11, c: 12 };

/** Relative weight of a tracking class; unknown classes weigh nothing. */
export function trackingWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalTrackingWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + trackingWeight(key), 0);
}
