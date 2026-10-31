// reports: anomaly helpers.

/** Known anomaly codes and what they mean. */
export const ANOMALY_CODES: Record<string, string> = {
  AN01: "partial anomaly route",
  AN02: "primary anomaly window",
  AN03: "secondary anomaly policy",
  AN04: "legacy anomaly rule",
  AN05: "trial anomaly check",
  AN06: "internal anomaly ticket",
  AN07: "external anomaly queue",
  AN08: "priority anomaly slot",
  AN09: "deferred anomaly lane",
  AN10: "standard anomaly tier",
  AN11: "express anomaly group",
  AN12: "fragile anomaly profile",
  AN13: "bulky anomaly rate",
  AN14: "seasonal anomaly cap",
  AN15: "returnable anomaly quota",
  AN16: "perishable anomaly cycle",
  AN17: "regulated anomaly ledger",
  AN18: "oversized anomaly session",
  AN19: "premium anomaly contact",
  AN20: "discounted anomaly notice",
  AN21: "limited anomaly plan",
  AN22: "archived anomaly request",
  AN23: "pending anomaly record",
  AN24: "verified anomaly entry",
};

/** Description of a anomaly code, or "unknown anomaly code: <code>". */
export function describeAnomaly(code: string): string {
  return ANOMALY_CODES[code] ?? `unknown anomaly code: ${code}`;
}

/** anomaly codes are upper-case and prefixed with their kind. */
export function formatAnomaly(value: string): string {
  return "ANO-" + value.trim().toUpperCase();
}

/** Inverse of `formatAnomaly`; undefined when the prefix does not match. */
export function parseAnomaly(code: string): string | undefined {
  const prefix = "ANO-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the anomaly limits (2 to 118). */
export function isAnomalyValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 118;
}

export function clampAnomaly(n: number): number {
  return Math.min(118, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 19, b: 20, c: 21 };

/** Relative weight of a anomaly class; unknown classes weigh nothing. */
export function anomalyWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalAnomalyWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + anomalyWeight(key), 0);
}
