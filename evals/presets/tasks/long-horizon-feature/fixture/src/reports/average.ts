// reports: average helpers.

/** Known average codes and what they mean. */
export const AVERAGE_CODES: Record<string, string> = {
  AV01: "pending average group",
  AV02: "verified average profile",
  AV03: "flagged average rate",
  AV04: "manual average cap",
  AV05: "automatic average quota",
  AV06: "partial average cycle",
  AV07: "primary average ledger",
  AV08: "secondary average session",
  AV09: "legacy average contact",
  AV10: "trial average notice",
  AV11: "internal average plan",
  AV12: "external average request",
  AV13: "priority average record",
  AV14: "deferred average entry",
  AV15: "standard average batch",
  AV16: "express average route",
  AV17: "fragile average window",
  AV18: "bulky average policy",
  AV19: "seasonal average rule",
  AV20: "returnable average check",
  AV21: "perishable average ticket",
  AV22: "regulated average queue",
  AV23: "oversized average slot",
  AV24: "premium average lane",
};

/** Description of a average code, or "unknown average code: <code>". */
export function describeAverage(code: string): string {
  return AVERAGE_CODES[code] ?? `unknown average code: ${code}`;
}

/** average codes are upper-case and prefixed with their kind. */
export function formatAverage(value: string): string {
  return "AVE-" + value.trim().toUpperCase();
}

/** Inverse of `formatAverage`; undefined when the prefix does not match. */
export function parseAverage(code: string): string | undefined {
  const prefix = "AVE-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the average limits (1 to 113). */
export function isAverageValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 113;
}

export function clampAverage(n: number): number {
  return Math.min(113, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 14, b: 15, c: 16 };

/** Relative weight of a average class; unknown classes weigh nothing. */
export function averageWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalAverageWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + averageWeight(key), 0);
}
