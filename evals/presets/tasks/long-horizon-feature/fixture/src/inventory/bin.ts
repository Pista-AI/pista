// inventory: bin helpers.

/** Known bin codes and what they mean. */
export const BIN_CODES: Record<string, string> = {
  BI01: "express bin batch",
  BI02: "fragile bin route",
  BI03: "bulky bin window",
  BI04: "seasonal bin policy",
  BI05: "returnable bin rule",
  BI06: "perishable bin check",
  BI07: "regulated bin ticket",
  BI08: "oversized bin queue",
  BI09: "premium bin slot",
  BI10: "discounted bin lane",
  BI11: "limited bin tier",
  BI12: "archived bin group",
  BI13: "pending bin profile",
  BI14: "verified bin rate",
  BI15: "flagged bin cap",
  BI16: "manual bin quota",
  BI17: "automatic bin cycle",
  BI18: "partial bin ledger",
  BI19: "primary bin session",
  BI20: "secondary bin contact",
  BI21: "legacy bin notice",
  BI22: "trial bin plan",
  BI23: "internal bin request",
  BI24: "external bin record",
};

/** Description of a bin code, or "unknown bin code: <code>". */
export function describeBin(code: string): string {
  return BIN_CODES[code] ?? `unknown bin code: ${code}`;
}

/** bin codes are upper-case and prefixed with their kind. */
export function formatBin(value: string): string {
  return "BIN-" + value.trim().toUpperCase();
}

/** Inverse of `formatBin`; undefined when the prefix does not match. */
export function parseBin(code: string): string | undefined {
  const prefix = "BIN-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the bin limits (1 to 101). */
export function isBinValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 101;
}

export function clampBin(n: number): number {
  return Math.min(101, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 2, b: 3, c: 4 };

/** Relative weight of a bin class; unknown classes weigh nothing. */
export function binWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalBinWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + binWeight(key), 0);
}
