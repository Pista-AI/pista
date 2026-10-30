// billing: payout helpers.

/** Known payout codes and what they mean. */
export const PAYOUT_CODES: Record<string, string> = {
  PA01: "bulky payout ticket",
  PA02: "seasonal payout queue",
  PA03: "returnable payout slot",
  PA04: "perishable payout lane",
  PA05: "regulated payout tier",
  PA06: "oversized payout group",
  PA07: "premium payout profile",
  PA08: "discounted payout rate",
  PA09: "limited payout cap",
  PA10: "archived payout quota",
  PA11: "pending payout cycle",
  PA12: "verified payout ledger",
  PA13: "flagged payout session",
  PA14: "manual payout contact",
  PA15: "automatic payout notice",
  PA16: "partial payout plan",
  PA17: "primary payout request",
  PA18: "secondary payout record",
  PA19: "legacy payout entry",
  PA20: "trial payout batch",
  PA21: "internal payout route",
  PA22: "external payout window",
  PA23: "priority payout policy",
  PA24: "deferred payout rule",
};

/** Description of a payout code, or "unknown payout code: <code>". */
export function describePayout(code: string): string {
  return PAYOUT_CODES[code] ?? `unknown payout code: ${code}`;
}

/** payout codes are upper-case and prefixed with their kind. */
export function formatPayout(value: string): string {
  return "PAY-" + value.trim().toUpperCase();
}

/** Inverse of `formatPayout`; undefined when the prefix does not match. */
export function parsePayout(code: string): string | undefined {
  const prefix = "PAY-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the payout limits (3 to 103). */
export function isPayoutValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 103;
}

export function clampPayout(n: number): number {
  return Math.min(103, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 4, b: 5, c: 6 };

/** Relative weight of a payout class; unknown classes weigh nothing. */
export function payoutWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalPayoutWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + payoutWeight(key), 0);
}
