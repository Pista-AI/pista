// orders: upsell helpers.

/** Known upsell codes and what they mean. */
export const UPSELL_CODES: Record<string, string> = {
  UP01: "regulated upsell entry",
  UP02: "oversized upsell batch",
  UP03: "premium upsell route",
  UP04: "discounted upsell window",
  UP05: "limited upsell policy",
  UP06: "archived upsell rule",
  UP07: "pending upsell check",
  UP08: "verified upsell ticket",
  UP09: "flagged upsell queue",
  UP10: "manual upsell slot",
  UP11: "automatic upsell lane",
  UP12: "partial upsell tier",
  UP13: "primary upsell group",
  UP14: "secondary upsell profile",
  UP15: "legacy upsell rate",
  UP16: "trial upsell cap",
  UP17: "internal upsell quota",
  UP18: "external upsell cycle",
  UP19: "priority upsell ledger",
  UP20: "deferred upsell session",
  UP21: "standard upsell contact",
  UP22: "express upsell notice",
  UP23: "fragile upsell plan",
  UP24: "bulky upsell request",
};

/** Description of a upsell code, or "unknown upsell code: <code>". */
export function describeUpsell(code: string): string {
  return UPSELL_CODES[code] ?? `unknown upsell code: ${code}`;
}

/** upsell codes are upper-case and prefixed with their kind. */
export function formatUpsell(value: string): string {
  return "UPS-" + value.trim().toUpperCase();
}

/** Inverse of `formatUpsell`; undefined when the prefix does not match. */
export function parseUpsell(code: string): string | undefined {
  const prefix = "UPS-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the upsell limits (2 to 134). */
export function isUpsellValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 134;
}

export function clampUpsell(n: number): number {
  return Math.min(134, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 35, b: 36, c: 37 };

/** Relative weight of a upsell class; unknown classes weigh nothing. */
export function upsellWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalUpsellWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + upsellWeight(key), 0);
}
