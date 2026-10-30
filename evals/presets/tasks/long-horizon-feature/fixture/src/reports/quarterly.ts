// reports: quarterly helpers.

/** Known quarterly codes and what they mean. */
export const QUARTERLY_CODES: Record<string, string> = {
  QU01: "bulky quarterly ticket",
  QU02: "seasonal quarterly queue",
  QU03: "returnable quarterly slot",
  QU04: "perishable quarterly lane",
  QU05: "regulated quarterly tier",
  QU06: "oversized quarterly group",
  QU07: "premium quarterly profile",
  QU08: "discounted quarterly rate",
  QU09: "limited quarterly cap",
  QU10: "archived quarterly quota",
  QU11: "pending quarterly cycle",
  QU12: "verified quarterly ledger",
  QU13: "flagged quarterly session",
  QU14: "manual quarterly contact",
  QU15: "automatic quarterly notice",
  QU16: "partial quarterly plan",
  QU17: "primary quarterly request",
  QU18: "secondary quarterly record",
  QU19: "legacy quarterly entry",
  QU20: "trial quarterly batch",
  QU21: "internal quarterly route",
  QU22: "external quarterly window",
  QU23: "priority quarterly policy",
  QU24: "deferred quarterly rule",
};

/** Description of a quarterly code, or "unknown quarterly code: <code>". */
export function describeQuarterly(code: string): string {
  return QUARTERLY_CODES[code] ?? `unknown quarterly code: ${code}`;
}

/** quarterly codes are upper-case and prefixed with their kind. */
export function formatQuarterly(value: string): string {
  return "QUA-" + value.trim().toUpperCase();
}

/** Inverse of `formatQuarterly`; undefined when the prefix does not match. */
export function parseQuarterly(code: string): string | undefined {
  const prefix = "QUA-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the quarterly limits (3 to 103). */
export function isQuarterlyValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 103;
}

export function clampQuarterly(n: number): number {
  return Math.min(103, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 4, b: 5, c: 6 };

/** Relative weight of a quarterly class; unknown classes weigh nothing. */
export function quarterlyWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalQuarterlyWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + quarterlyWeight(key), 0);
}
