// orders: fee helpers.

/** Known fee codes and what they mean. */
export const FEE_CODES: Record<string, string> = {
  FE01: "external fee contact",
  FE02: "priority fee notice",
  FE03: "deferred fee plan",
  FE04: "standard fee request",
  FE05: "express fee record",
  FE06: "fragile fee entry",
  FE07: "bulky fee batch",
  FE08: "seasonal fee route",
  FE09: "returnable fee window",
  FE10: "perishable fee policy",
  FE11: "regulated fee rule",
  FE12: "oversized fee check",
  FE13: "premium fee ticket",
  FE14: "discounted fee queue",
  FE15: "limited fee slot",
  FE16: "archived fee lane",
  FE17: "pending fee tier",
  FE18: "verified fee group",
  FE19: "flagged fee profile",
  FE20: "manual fee rate",
  FE21: "automatic fee cap",
  FE22: "partial fee quota",
  FE23: "primary fee cycle",
  FE24: "secondary fee ledger",
};

/** Description of a fee code, or "unknown fee code: <code>". */
export function describeFee(code: string): string {
  return FEE_CODES[code] ?? `unknown fee code: ${code}`;
}

/** fee codes are upper-case and prefixed with their kind. */
export function formatFee(value: string): string {
  return "FEE-" + value.trim().toUpperCase();
}

/** Inverse of `formatFee`; undefined when the prefix does not match. */
export function parseFee(code: string): string | undefined {
  const prefix = "FEE-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the fee limits (0 to 124). */
export function isFeeValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 124;
}

export function clampFee(n: number): number {
  return Math.min(124, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 25, b: 26, c: 27 };

/** Relative weight of a fee class; unknown classes weigh nothing. */
export function feeWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalFeeWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + feeWeight(key), 0);
}
