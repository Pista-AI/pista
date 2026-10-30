// billing: account helpers.

/** Known account codes and what they mean. */
export const ACCOUNT_CODES: Record<string, string> = {
  AC01: "express account batch",
  AC02: "fragile account route",
  AC03: "bulky account window",
  AC04: "seasonal account policy",
  AC05: "returnable account rule",
  AC06: "perishable account check",
  AC07: "regulated account ticket",
  AC08: "oversized account queue",
  AC09: "premium account slot",
  AC10: "discounted account lane",
  AC11: "limited account tier",
  AC12: "archived account group",
  AC13: "pending account profile",
  AC14: "verified account rate",
  AC15: "flagged account cap",
  AC16: "manual account quota",
  AC17: "automatic account cycle",
  AC18: "partial account ledger",
  AC19: "primary account session",
  AC20: "secondary account contact",
  AC21: "legacy account notice",
  AC22: "trial account plan",
  AC23: "internal account request",
  AC24: "external account record",
};

/** Description of a account code, or "unknown account code: <code>". */
export function describeAccount(code: string): string {
  return ACCOUNT_CODES[code] ?? `unknown account code: ${code}`;
}

/** Scales a account amount by the module factor and rounds to a whole number. */
export function accountScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function accountShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 account" or "3 accounts". */
export function accountLabel(count: number): string {
  return count === 1 ? "1 account" : `${count} accounts`;
}

export function accountSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** account codes are upper-case and prefixed with their kind. */
export function formatAccount(value: string): string {
  return "ACC-" + value.trim().toUpperCase();
}

/** Inverse of `formatAccount`; undefined when the prefix does not match. */
export function parseAccount(code: string): string | undefined {
  const prefix = "ACC-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
