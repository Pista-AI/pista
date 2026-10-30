// inventory: batch helpers.

/** Known batch codes and what they mean. */
export const BATCH_CODES: Record<string, string> = {
  BA01: "oversized batch plan",
  BA02: "premium batch request",
  BA03: "discounted batch record",
  BA04: "limited batch entry",
  BA05: "archived batch batch",
  BA06: "pending batch route",
  BA07: "verified batch window",
  BA08: "flagged batch policy",
  BA09: "manual batch rule",
  BA10: "automatic batch check",
  BA11: "partial batch ticket",
  BA12: "primary batch queue",
  BA13: "secondary batch slot",
  BA14: "legacy batch lane",
  BA15: "trial batch tier",
  BA16: "internal batch group",
  BA17: "external batch profile",
  BA18: "priority batch rate",
  BA19: "deferred batch cap",
  BA20: "standard batch quota",
  BA21: "express batch cycle",
  BA22: "fragile batch ledger",
  BA23: "bulky batch session",
  BA24: "seasonal batch contact",
};

/** Description of a batch code, or "unknown batch code: <code>". */
export function describeBatch(code: string): string {
  return BATCH_CODES[code] ?? `unknown batch code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 9, b: 10, c: 11 };

/** Relative weight of a batch class; unknown classes weigh nothing. */
export function batchWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalBatchWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + batchWeight(key), 0);
}

/** Scales a batch amount by the module factor and rounds to a whole number. */
export function batchScale(value: number, factor = 5): number {
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
