// orders: receipt helpers.

/** Known receipt codes and what they mean. */
export const RECEIPT_CODES: Record<string, string> = {
  RE01: "verified receipt cap",
  RE02: "flagged receipt quota",
  RE03: "manual receipt cycle",
  RE04: "automatic receipt ledger",
  RE05: "partial receipt session",
  RE06: "primary receipt contact",
  RE07: "secondary receipt notice",
  RE08: "legacy receipt plan",
  RE09: "trial receipt request",
  RE10: "internal receipt record",
  RE11: "external receipt entry",
  RE12: "priority receipt batch",
  RE13: "deferred receipt route",
  RE14: "standard receipt window",
  RE15: "express receipt policy",
  RE16: "fragile receipt rule",
  RE17: "bulky receipt check",
  RE18: "seasonal receipt ticket",
  RE19: "returnable receipt queue",
  RE20: "perishable receipt slot",
  RE21: "regulated receipt lane",
  RE22: "oversized receipt tier",
  RE23: "premium receipt group",
  RE24: "discounted receipt profile",
};

/** Description of a receipt code, or "unknown receipt code: <code>". */
export function describeReceipt(code: string): string {
  return RECEIPT_CODES[code] ?? `unknown receipt code: ${code}`;
}

/** receipt codes are upper-case and prefixed with their kind. */
export function formatReceipt(value: string): string {
  return "REC-" + value.trim().toUpperCase();
}

/** Inverse of `formatReceipt`; undefined when the prefix does not match. */
export function parseReceipt(code: string): string | undefined {
  const prefix = "REC-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the receipt limits (2 to 114). */
export function isReceiptValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 114;
}

export function clampReceipt(n: number): number {
  return Math.min(114, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 15, b: 16, c: 17 };

/** Relative weight of a receipt class; unknown classes weigh nothing. */
export function receiptWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalReceiptWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + receiptWeight(key), 0);
}
