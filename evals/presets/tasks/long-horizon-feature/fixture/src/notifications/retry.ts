// notifications: retry helpers.

/** Known retry codes and what they mean. */
export const RETRY_CODES: Record<string, string> = {
  RE01: "verified retry cap",
  RE02: "flagged retry quota",
  RE03: "manual retry cycle",
  RE04: "automatic retry ledger",
  RE05: "partial retry session",
  RE06: "primary retry contact",
  RE07: "secondary retry notice",
  RE08: "legacy retry plan",
  RE09: "trial retry request",
  RE10: "internal retry record",
  RE11: "external retry entry",
  RE12: "priority retry batch",
  RE13: "deferred retry route",
  RE14: "standard retry window",
  RE15: "express retry policy",
  RE16: "fragile retry rule",
  RE17: "bulky retry check",
  RE18: "seasonal retry ticket",
  RE19: "returnable retry queue",
  RE20: "perishable retry slot",
  RE21: "regulated retry lane",
  RE22: "oversized retry tier",
  RE23: "premium retry group",
  RE24: "discounted retry profile",
};

/** Description of a retry code, or "unknown retry code: <code>". */
export function describeRetry(code: string): string {
  return RETRY_CODES[code] ?? `unknown retry code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 15, b: 16, c: 17 };

/** Relative weight of a retry class; unknown classes weigh nothing. */
export function retryWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalRetryWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + retryWeight(key), 0);
}

/** Scales a retry amount by the module factor and rounds to a whole number. */
export function retryScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function retryShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 retry" or "3 retrys". */
export function retryLabel(count: number): string {
  return count === 1 ? "1 retry" : `${count} retrys`;
}

export function retrySummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
