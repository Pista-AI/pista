// inventory: count helpers.

/** Known count codes and what they mean. */
export const COUNT_CODES: Record<string, string> = {
  CO01: "secondary count queue",
  CO02: "legacy count slot",
  CO03: "trial count lane",
  CO04: "internal count tier",
  CO05: "external count group",
  CO06: "priority count profile",
  CO07: "deferred count rate",
  CO08: "standard count cap",
  CO09: "express count quota",
  CO10: "fragile count cycle",
  CO11: "bulky count ledger",
  CO12: "seasonal count session",
  CO13: "returnable count contact",
  CO14: "perishable count notice",
  CO15: "regulated count plan",
  CO16: "oversized count request",
  CO17: "premium count record",
  CO18: "discounted count entry",
  CO19: "limited count batch",
  CO20: "archived count route",
  CO21: "pending count window",
  CO22: "verified count policy",
  CO23: "flagged count rule",
  CO24: "manual count check",
};

/** Description of a count code, or "unknown count code: <code>". */
export function describeCount(code: string): string {
  return COUNT_CODES[code] ?? `unknown count code: ${code}`;
}

/** "1 count" or "3 counts". */
export function countLabel(count: number): string {
  return count === 1 ? "1 count" : `${count} counts`;
}

export function countSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** count codes are upper-case and prefixed with their kind. */
export function formatCount(value: string): string {
  return "COU-" + value.trim().toUpperCase();
}

/** Inverse of `formatCount`; undefined when the prefix does not match. */
export function parseCount(code: string): string | undefined {
  const prefix = "COU-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the count limits (0 to 120). */
export function isCountValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 120;
}

export function clampCount(n: number): number {
  return Math.min(120, Math.max(0, Math.trunc(n)));
}
