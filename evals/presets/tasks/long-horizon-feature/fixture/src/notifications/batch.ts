// notifications: batch helpers.

/** Known batch codes and what they mean. */
export const BATCH_CODES: Record<string, string> = {
  BA01: "fragile batch lane",
  BA02: "bulky batch tier",
  BA03: "seasonal batch group",
  BA04: "returnable batch profile",
  BA05: "perishable batch rate",
  BA06: "regulated batch cap",
  BA07: "oversized batch quota",
  BA08: "premium batch cycle",
  BA09: "discounted batch ledger",
  BA10: "limited batch session",
  BA11: "archived batch contact",
  BA12: "pending batch notice",
  BA13: "verified batch plan",
  BA14: "flagged batch request",
  BA15: "manual batch record",
  BA16: "automatic batch entry",
  BA17: "partial batch batch",
  BA18: "primary batch route",
  BA19: "secondary batch window",
  BA20: "legacy batch policy",
  BA21: "trial batch rule",
  BA22: "internal batch check",
  BA23: "external batch ticket",
  BA24: "priority batch queue",
};

/** Description of a batch code, or "unknown batch code: <code>". */
export function describeBatch(code: string): string {
  return BATCH_CODES[code] ?? `unknown batch code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 30, b: 31, c: 32 };

/** Relative weight of a batch class; unknown classes weigh nothing. */
export function batchWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalBatchWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + batchWeight(key), 0);
}

/** Scales a batch amount by the module factor and rounds to a whole number. */
export function batchScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function batchShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 batch" or "3 batchs". */
export function batchLabel(count: number): string {
  return count === 1 ? "1 batch" : `${count} batchs`;
}

export function batchSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
