// notifications: pager helpers.

/** Known pager codes and what they mean. */
export const PAGER_CODES: Record<string, string> = {
  PA01: "standard pager policy",
  PA02: "express pager rule",
  PA03: "fragile pager check",
  PA04: "bulky pager ticket",
  PA05: "seasonal pager queue",
  PA06: "returnable pager slot",
  PA07: "perishable pager lane",
  PA08: "regulated pager tier",
  PA09: "oversized pager group",
  PA10: "premium pager profile",
  PA11: "discounted pager rate",
  PA12: "limited pager cap",
  PA13: "archived pager quota",
  PA14: "pending pager cycle",
  PA15: "verified pager ledger",
  PA16: "flagged pager session",
  PA17: "manual pager contact",
  PA18: "automatic pager notice",
  PA19: "partial pager plan",
  PA20: "primary pager request",
  PA21: "secondary pager record",
  PA22: "legacy pager entry",
  PA23: "trial pager batch",
  PA24: "internal pager route",
};

/** Description of a pager code, or "unknown pager code: <code>". */
export function describePager(code: string): string {
  return PAGER_CODES[code] ?? `unknown pager code: ${code}`;
}

/** pager codes are upper-case and prefixed with their kind. */
export function formatPager(value: string): string {
  return "PAG-" + value.trim().toUpperCase();
}

/** Inverse of `formatPager`; undefined when the prefix does not match. */
export function parsePager(code: string): string | undefined {
  const prefix = "PAG-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the pager limits (3 to 127). */
export function isPagerValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 127;
}

export function clampPager(n: number): number {
  return Math.min(127, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 28, b: 29, c: 30 };

/** Relative weight of a pager class; unknown classes weigh nothing. */
export function pagerWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalPagerWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + pagerWeight(key), 0);
}
