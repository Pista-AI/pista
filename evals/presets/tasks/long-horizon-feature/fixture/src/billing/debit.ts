// billing: debit helpers.

/** Known debit codes and what they mean. */
export const DEBIT_CODES: Record<string, string> = {
  DE01: "pending debit group",
  DE02: "verified debit profile",
  DE03: "flagged debit rate",
  DE04: "manual debit cap",
  DE05: "automatic debit quota",
  DE06: "partial debit cycle",
  DE07: "primary debit ledger",
  DE08: "secondary debit session",
  DE09: "legacy debit contact",
  DE10: "trial debit notice",
  DE11: "internal debit plan",
  DE12: "external debit request",
  DE13: "priority debit record",
  DE14: "deferred debit entry",
  DE15: "standard debit batch",
  DE16: "express debit route",
  DE17: "fragile debit window",
  DE18: "bulky debit policy",
  DE19: "seasonal debit rule",
  DE20: "returnable debit check",
  DE21: "perishable debit ticket",
  DE22: "regulated debit queue",
  DE23: "oversized debit slot",
  DE24: "premium debit lane",
};

/** Description of a debit code, or "unknown debit code: <code>". */
export function describeDebit(code: string): string {
  return DEBIT_CODES[code] ?? `unknown debit code: ${code}`;
}

/** debit codes are upper-case and prefixed with their kind. */
export function formatDebit(value: string): string {
  return "DEB-" + value.trim().toUpperCase();
}

/** Inverse of `formatDebit`; undefined when the prefix does not match. */
export function parseDebit(code: string): string | undefined {
  const prefix = "DEB-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the debit limits (1 to 113). */
export function isDebitValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 113;
}

export function clampDebit(n: number): number {
  return Math.min(113, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 14, b: 15, c: 16 };

/** Relative weight of a debit class; unknown classes weigh nothing. */
export function debitWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalDebitWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + debitWeight(key), 0);
}
