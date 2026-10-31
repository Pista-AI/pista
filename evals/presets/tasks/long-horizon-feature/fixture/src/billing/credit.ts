// billing: credit helpers.

/** Known credit codes and what they mean. */
export const CREDIT_CODES: Record<string, string> = {
  CR01: "archived credit slot",
  CR02: "pending credit lane",
  CR03: "verified credit tier",
  CR04: "flagged credit group",
  CR05: "manual credit profile",
  CR06: "automatic credit rate",
  CR07: "partial credit cap",
  CR08: "primary credit quota",
  CR09: "secondary credit cycle",
  CR10: "legacy credit ledger",
  CR11: "trial credit session",
  CR12: "internal credit contact",
  CR13: "external credit notice",
  CR14: "priority credit plan",
  CR15: "deferred credit request",
  CR16: "standard credit record",
  CR17: "express credit entry",
  CR18: "fragile credit batch",
  CR19: "bulky credit route",
  CR20: "seasonal credit window",
  CR21: "returnable credit policy",
  CR22: "perishable credit rule",
  CR23: "regulated credit check",
  CR24: "oversized credit ticket",
};

/** Description of a credit code, or "unknown credit code: <code>". */
export function describeCredit(code: string): string {
  return CREDIT_CODES[code] ?? `unknown credit code: ${code}`;
}

/** "1 credit" or "3 credits". */
export function creditLabel(count: number): string {
  return count === 1 ? "1 credit" : `${count} credits`;
}

export function creditSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** credit codes are upper-case and prefixed with their kind. */
export function formatCredit(value: string): string {
  return "CRE-" + value.trim().toUpperCase();
}

/** Inverse of `formatCredit`; undefined when the prefix does not match. */
export function parseCredit(code: string): string | undefined {
  const prefix = "CRE-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the credit limits (0 to 112). */
export function isCreditValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 112;
}

export function clampCredit(n: number): number {
  return Math.min(112, Math.max(0, Math.trunc(n)));
}
