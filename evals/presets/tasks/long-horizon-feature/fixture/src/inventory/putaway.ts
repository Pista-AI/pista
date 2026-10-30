// inventory: putaway helpers.

/** Known putaway codes and what they mean. */
export const PUTAWAY_CODES: Record<string, string> = {
  PU01: "internal putaway cycle",
  PU02: "external putaway ledger",
  PU03: "priority putaway session",
  PU04: "deferred putaway contact",
  PU05: "standard putaway notice",
  PU06: "express putaway plan",
  PU07: "fragile putaway request",
  PU08: "bulky putaway record",
  PU09: "seasonal putaway entry",
  PU10: "returnable putaway batch",
  PU11: "perishable putaway route",
  PU12: "regulated putaway window",
  PU13: "oversized putaway policy",
  PU14: "premium putaway rule",
  PU15: "discounted putaway check",
  PU16: "limited putaway ticket",
  PU17: "archived putaway queue",
  PU18: "pending putaway slot",
  PU19: "verified putaway lane",
  PU20: "flagged putaway tier",
  PU21: "manual putaway group",
  PU22: "automatic putaway profile",
  PU23: "partial putaway rate",
  PU24: "primary putaway cap",
};

/** Description of a putaway code, or "unknown putaway code: <code>". */
export function describePutaway(code: string): string {
  return PUTAWAY_CODES[code] ?? `unknown putaway code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 24, b: 25, c: 26 };

/** Relative weight of a putaway class; unknown classes weigh nothing. */
export function putawayWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalPutawayWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + putawayWeight(key), 0);
}

/** Scales a putaway amount by the module factor and rounds to a whole number. */
export function putawayScale(value: number, factor = 5): number {
  return Math.round(value * factor);
}

export function putawayShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 putaway" or "3 putaways". */
export function putawayLabel(count: number): string {
  return count === 1 ? "1 putaway" : `${count} putaways`;
}

export function putawaySummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
