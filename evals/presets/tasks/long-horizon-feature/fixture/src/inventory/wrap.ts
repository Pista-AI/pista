// inventory: wrap helpers.

/** Known wrap codes and what they mean. */
export const WRAP_CODES: Record<string, string> = {
  WR01: "limited wrap group",
  WR02: "archived wrap profile",
  WR03: "pending wrap rate",
  WR04: "verified wrap cap",
  WR05: "flagged wrap quota",
  WR06: "manual wrap cycle",
  WR07: "automatic wrap ledger",
  WR08: "partial wrap session",
  WR09: "primary wrap contact",
  WR10: "secondary wrap notice",
  WR11: "legacy wrap plan",
  WR12: "trial wrap request",
  WR13: "internal wrap record",
  WR14: "external wrap entry",
  WR15: "priority wrap batch",
  WR16: "deferred wrap route",
  WR17: "standard wrap window",
  WR18: "express wrap policy",
  WR19: "fragile wrap rule",
  WR20: "bulky wrap check",
  WR21: "seasonal wrap ticket",
  WR22: "returnable wrap queue",
  WR23: "perishable wrap slot",
  WR24: "regulated wrap lane",
};

/** Description of a wrap code, or "unknown wrap code: <code>". */
export function describeWrap(code: string): string {
  return WRAP_CODES[code] ?? `unknown wrap code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 39, b: 40, c: 41 };

/** Relative weight of a wrap class; unknown classes weigh nothing. */
export function wrapWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalWrapWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + wrapWeight(key), 0);
}

/** Scales a wrap amount by the module factor and rounds to a whole number. */
export function wrapScale(value: number, factor = 5): number {
  return Math.round(value * factor);
}

export function wrapShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 wrap" or "3 wraps". */
export function wrapLabel(count: number): string {
  return count === 1 ? "1 wrap" : `${count} wraps`;
}

export function wrapSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
