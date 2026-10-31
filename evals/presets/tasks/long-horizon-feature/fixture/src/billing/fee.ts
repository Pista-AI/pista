// billing: fee helpers.

/** Known fee codes and what they mean. */
export const FEE_CODES: Record<string, string> = {
  FE01: "discounted fee window",
  FE02: "limited fee policy",
  FE03: "archived fee rule",
  FE04: "pending fee check",
  FE05: "verified fee ticket",
  FE06: "flagged fee queue",
  FE07: "manual fee slot",
  FE08: "automatic fee lane",
  FE09: "partial fee tier",
  FE10: "primary fee group",
  FE11: "secondary fee profile",
  FE12: "legacy fee rate",
  FE13: "trial fee cap",
  FE14: "internal fee quota",
  FE15: "external fee cycle",
  FE16: "priority fee ledger",
  FE17: "deferred fee session",
  FE18: "standard fee contact",
  FE19: "express fee notice",
  FE20: "fragile fee plan",
  FE21: "bulky fee request",
  FE22: "seasonal fee record",
  FE23: "returnable fee entry",
  FE24: "perishable fee batch",
};

/** Description of a fee code, or "unknown fee code: <code>". */
export function describeFee(code: string): string {
  return FEE_CODES[code] ?? `unknown fee code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 11, b: 12, c: 13 };

/** Relative weight of a fee class; unknown classes weigh nothing. */
export function feeWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalFeeWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + feeWeight(key), 0);
}

/** Scales a fee amount by the module factor and rounds to a whole number. */
export function feeScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function feeShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 fee" or "3 fees". */
export function feeLabel(count: number): string {
  return count === 1 ? "1 fee" : `${count} fees`;
}

export function feeSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
