// orders: promo helpers.

/** Known promo codes and what they mean. */
export const PROMO_CODES: Record<string, string> = {
  PR01: "perishable promo plan",
  PR02: "regulated promo request",
  PR03: "oversized promo record",
  PR04: "premium promo entry",
  PR05: "discounted promo batch",
  PR06: "limited promo route",
  PR07: "archived promo window",
  PR08: "pending promo policy",
  PR09: "verified promo rule",
  PR10: "flagged promo check",
  PR11: "manual promo ticket",
  PR12: "automatic promo queue",
  PR13: "partial promo slot",
  PR14: "primary promo lane",
  PR15: "secondary promo tier",
  PR16: "legacy promo group",
  PR17: "trial promo profile",
  PR18: "internal promo rate",
  PR19: "external promo cap",
  PR20: "priority promo quota",
  PR21: "deferred promo cycle",
  PR22: "standard promo ledger",
  PR23: "express promo session",
  PR24: "fragile promo contact",
};

/** Description of a promo code, or "unknown promo code: <code>". */
export function describePromo(code: string): string {
  return PROMO_CODES[code] ?? `unknown promo code: ${code}`;
}

/** "1 promo" or "3 promos". */
export function promoLabel(count: number): string {
  return count === 1 ? "1 promo" : `${count} promos`;
}

export function promoSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** promo codes are upper-case and prefixed with their kind. */
export function formatPromo(value: string): string {
  return "PRO-" + value.trim().toUpperCase();
}

/** Inverse of `formatPromo`; undefined when the prefix does not match. */
export function parsePromo(code: string): string | undefined {
  const prefix = "PRO-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the promo limits (1 to 133). */
export function isPromoValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 133;
}

export function clampPromo(n: number): number {
  return Math.min(133, Math.max(1, Math.trunc(n)));
}
