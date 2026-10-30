// billing: tier helpers.

/** Known tier codes and what they mean. */
export const TIER_CODES: Record<string, string> = {
  TI01: "secondary tier queue",
  TI02: "legacy tier slot",
  TI03: "trial tier lane",
  TI04: "internal tier tier",
  TI05: "external tier group",
  TI06: "priority tier profile",
  TI07: "deferred tier rate",
  TI08: "standard tier cap",
  TI09: "express tier quota",
  TI10: "fragile tier cycle",
  TI11: "bulky tier ledger",
  TI12: "seasonal tier session",
  TI13: "returnable tier contact",
  TI14: "perishable tier notice",
  TI15: "regulated tier plan",
  TI16: "oversized tier request",
  TI17: "premium tier record",
  TI18: "discounted tier entry",
  TI19: "limited tier batch",
  TI20: "archived tier route",
  TI21: "pending tier window",
  TI22: "verified tier policy",
  TI23: "flagged tier rule",
  TI24: "manual tier check",
};

/** Description of a tier code, or "unknown tier code: <code>". */
export function describeTier(code: string): string {
  return TIER_CODES[code] ?? `unknown tier code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 21, b: 22, c: 23 };

/** Relative weight of a tier class; unknown classes weigh nothing. */
export function tierWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalTierWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + tierWeight(key), 0);
}

/** Scales a tier amount by the module factor and rounds to a whole number. */
export function tierScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function tierShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 tier" or "3 tiers". */
export function tierLabel(count: number): string {
  return count === 1 ? "1 tier" : `${count} tiers`;
}

export function tierSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
