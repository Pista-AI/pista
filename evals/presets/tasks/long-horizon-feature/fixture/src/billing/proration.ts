// billing: proration helpers.

/** Known proration codes and what they mean. */
export const PRORATION_CODES: Record<string, string> = {
  PR01: "partial proration route",
  PR02: "primary proration window",
  PR03: "secondary proration policy",
  PR04: "legacy proration rule",
  PR05: "trial proration check",
  PR06: "internal proration ticket",
  PR07: "external proration queue",
  PR08: "priority proration slot",
  PR09: "deferred proration lane",
  PR10: "standard proration tier",
  PR11: "express proration group",
  PR12: "fragile proration profile",
  PR13: "bulky proration rate",
  PR14: "seasonal proration cap",
  PR15: "returnable proration quota",
  PR16: "perishable proration cycle",
  PR17: "regulated proration ledger",
  PR18: "oversized proration session",
  PR19: "premium proration contact",
  PR20: "discounted proration notice",
  PR21: "limited proration plan",
  PR22: "archived proration request",
  PR23: "pending proration record",
  PR24: "verified proration entry",
};

/** Description of a proration code, or "unknown proration code: <code>". */
export function describeProration(code: string): string {
  return PRORATION_CODES[code] ?? `unknown proration code: ${code}`;
}

/** proration codes are upper-case and prefixed with their kind. */
export function formatProration(value: string): string {
  return "PRO-" + value.trim().toUpperCase();
}

/** Inverse of `formatProration`; undefined when the prefix does not match. */
export function parseProration(code: string): string | undefined {
  const prefix = "PRO-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the proration limits (2 to 118). */
export function isProrationValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 118;
}

export function clampProration(n: number): number {
  return Math.min(118, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 19, b: 20, c: 21 };

/** Relative weight of a proration class; unknown classes weigh nothing. */
export function prorationWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalProrationWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + prorationWeight(key), 0);
}
