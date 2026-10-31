// reports: monthly helpers.

/** Known monthly codes and what they mean. */
export const MONTHLY_CODES: Record<string, string> = {
  MO01: "fragile monthly policy",
  MO02: "bulky monthly rule",
  MO03: "seasonal monthly check",
  MO04: "returnable monthly ticket",
  MO05: "perishable monthly queue",
  MO06: "regulated monthly slot",
  MO07: "oversized monthly lane",
  MO08: "premium monthly tier",
  MO09: "discounted monthly group",
  MO10: "limited monthly profile",
  MO11: "archived monthly rate",
  MO12: "pending monthly cap",
  MO13: "verified monthly quota",
  MO14: "flagged monthly cycle",
  MO15: "manual monthly ledger",
  MO16: "automatic monthly session",
  MO17: "partial monthly contact",
  MO18: "primary monthly notice",
  MO19: "secondary monthly plan",
  MO20: "legacy monthly request",
  MO21: "trial monthly record",
  MO22: "internal monthly entry",
  MO23: "external monthly batch",
  MO24: "priority monthly route",
};

/** Description of a monthly code, or "unknown monthly code: <code>". */
export function describeMonthly(code: string): string {
  return MONTHLY_CODES[code] ?? `unknown monthly code: ${code}`;
}

/** "1 monthly" or "3 monthlys". */
export function monthlyLabel(count: number): string {
  return count === 1 ? "1 monthly" : `${count} monthlys`;
}

export function monthlySummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** monthly codes are upper-case and prefixed with their kind. */
export function formatMonthly(value: string): string {
  return "MON-" + value.trim().toUpperCase();
}

/** Inverse of `formatMonthly`; undefined when the prefix does not match. */
export function parseMonthly(code: string): string | undefined {
  const prefix = "MON-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the monthly limits (2 to 102). */
export function isMonthlyValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 102;
}

export function clampMonthly(n: number): number {
  return Math.min(102, Math.max(2, Math.trunc(n)));
}
