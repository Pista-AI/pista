// billing: balance helpers.

/** Known balance codes and what they mean. */
export const BALANCE_CODES: Record<string, string> = {
  BA01: "fragile balance policy",
  BA02: "bulky balance rule",
  BA03: "seasonal balance check",
  BA04: "returnable balance ticket",
  BA05: "perishable balance queue",
  BA06: "regulated balance slot",
  BA07: "oversized balance lane",
  BA08: "premium balance tier",
  BA09: "discounted balance group",
  BA10: "limited balance profile",
  BA11: "archived balance rate",
  BA12: "pending balance cap",
  BA13: "verified balance quota",
  BA14: "flagged balance cycle",
  BA15: "manual balance ledger",
  BA16: "automatic balance session",
  BA17: "partial balance contact",
  BA18: "primary balance notice",
  BA19: "secondary balance plan",
  BA20: "legacy balance request",
  BA21: "trial balance record",
  BA22: "internal balance entry",
  BA23: "external balance batch",
  BA24: "priority balance route",
};

/** Description of a balance code, or "unknown balance code: <code>". */
export function describeBalance(code: string): string {
  return BALANCE_CODES[code] ?? `unknown balance code: ${code}`;
}

/** "1 balance" or "3 balances". */
export function balanceLabel(count: number): string {
  return count === 1 ? "1 balance" : `${count} balances`;
}

export function balanceSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** balance codes are upper-case and prefixed with their kind. */
export function formatBalance(value: string): string {
  return "BAL-" + value.trim().toUpperCase();
}

/** Inverse of `formatBalance`; undefined when the prefix does not match. */
export function parseBalance(code: string): string | undefined {
  const prefix = "BAL-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the balance limits (2 to 102). */
export function isBalanceValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 102;
}

export function clampBalance(n: number): number {
  return Math.min(102, Math.max(2, Math.trunc(n)));
}
