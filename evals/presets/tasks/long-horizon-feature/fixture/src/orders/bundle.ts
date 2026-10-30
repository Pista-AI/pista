// orders: bundle helpers.

/** Known bundle codes and what they mean. */
export const BUNDLE_CODES: Record<string, string> = {
  BU01: "primary bundle rule",
  BU02: "secondary bundle check",
  BU03: "legacy bundle ticket",
  BU04: "trial bundle queue",
  BU05: "internal bundle slot",
  BU06: "external bundle lane",
  BU07: "priority bundle tier",
  BU08: "deferred bundle group",
  BU09: "standard bundle profile",
  BU10: "express bundle rate",
  BU11: "fragile bundle cap",
  BU12: "bulky bundle quota",
  BU13: "seasonal bundle cycle",
  BU14: "returnable bundle ledger",
  BU15: "perishable bundle session",
  BU16: "regulated bundle contact",
  BU17: "oversized bundle notice",
  BU18: "premium bundle plan",
  BU19: "discounted bundle request",
  BU20: "limited bundle record",
  BU21: "archived bundle entry",
  BU22: "pending bundle batch",
  BU23: "verified bundle route",
  BU24: "flagged bundle window",
};

/** Description of a bundle code, or "unknown bundle code: <code>". */
export function describeBundle(code: string): string {
  return BUNDLE_CODES[code] ?? `unknown bundle code: ${code}`;
}

/** bundle codes are upper-case and prefixed with their kind. */
export function formatBundle(value: string): string {
  return "BUN-" + value.trim().toUpperCase();
}

/** Inverse of `formatBundle`; undefined when the prefix does not match. */
export function parseBundle(code: string): string | undefined {
  const prefix = "BUN-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the bundle limits (3 to 119). */
export function isBundleValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 119;
}

export function clampBundle(n: number): number {
  return Math.min(119, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 20, b: 21, c: 22 };

/** Relative weight of a bundle class; unknown classes weigh nothing. */
export function bundleWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalBundleWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + bundleWeight(key), 0);
}
