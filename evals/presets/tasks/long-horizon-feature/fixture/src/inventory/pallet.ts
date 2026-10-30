// inventory: pallet helpers.

/** Known pallet codes and what they mean. */
export const PALLET_CODES: Record<string, string> = {
  PA01: "bulky pallet ticket",
  PA02: "seasonal pallet queue",
  PA03: "returnable pallet slot",
  PA04: "perishable pallet lane",
  PA05: "regulated pallet tier",
  PA06: "oversized pallet group",
  PA07: "premium pallet profile",
  PA08: "discounted pallet rate",
  PA09: "limited pallet cap",
  PA10: "archived pallet quota",
  PA11: "pending pallet cycle",
  PA12: "verified pallet ledger",
  PA13: "flagged pallet session",
  PA14: "manual pallet contact",
  PA15: "automatic pallet notice",
  PA16: "partial pallet plan",
  PA17: "primary pallet request",
  PA18: "secondary pallet record",
  PA19: "legacy pallet entry",
  PA20: "trial pallet batch",
  PA21: "internal pallet route",
  PA22: "external pallet window",
  PA23: "priority pallet policy",
  PA24: "deferred pallet rule",
};

/** Description of a pallet code, or "unknown pallet code: <code>". */
export function describePallet(code: string): string {
  return PALLET_CODES[code] ?? `unknown pallet code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 4, b: 5, c: 6 };

/** Relative weight of a pallet class; unknown classes weigh nothing. */
export function palletWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalPalletWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + palletWeight(key), 0);
}

/** Scales a pallet amount by the module factor and rounds to a whole number. */
export function palletScale(value: number, factor = 5): number {
  return Math.round(value * factor);
}

export function palletShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 pallet" or "3 pallets". */
export function palletLabel(count: number): string {
  return count === 1 ? "1 pallet" : `${count} pallets`;
}

export function palletSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
