// billing: ledger helpers.

/** Known ledger codes and what they mean. */
export const LEDGER_CODES: Record<string, string> = {
  LE01: "standard ledger request",
  LE02: "express ledger record",
  LE03: "fragile ledger entry",
  LE04: "bulky ledger batch",
  LE05: "seasonal ledger route",
  LE06: "returnable ledger window",
  LE07: "perishable ledger policy",
  LE08: "regulated ledger rule",
  LE09: "oversized ledger check",
  LE10: "premium ledger ticket",
  LE11: "discounted ledger queue",
  LE12: "limited ledger slot",
  LE13: "archived ledger lane",
  LE14: "pending ledger tier",
  LE15: "verified ledger group",
  LE16: "flagged ledger profile",
  LE17: "manual ledger rate",
  LE18: "automatic ledger cap",
  LE19: "partial ledger quota",
  LE20: "primary ledger cycle",
  LE21: "secondary ledger ledger",
  LE22: "legacy ledger session",
  LE23: "trial ledger contact",
  LE24: "internal ledger notice",
};

/** Description of a ledger code, or "unknown ledger code: <code>". */
export function describeLedger(code: string): string {
  return LEDGER_CODES[code] ?? `unknown ledger code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 1, b: 2, c: 3 };

/** Relative weight of a ledger class; unknown classes weigh nothing. */
export function ledgerWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalLedgerWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + ledgerWeight(key), 0);
}

/** Scales a ledger amount by the module factor and rounds to a whole number. */
export function ledgerScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function ledgerShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 ledger" or "3 ledgers". */
export function ledgerLabel(count: number): string {
  return count === 1 ? "1 ledger" : `${count} ledgers`;
}

export function ledgerSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
