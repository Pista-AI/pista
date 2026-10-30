// billing: reactivate helpers.

/** Known reactivate codes and what they mean. */
export const REACTIVATE_CODES: Record<string, string> = {
  RE01: "priority reactivate request",
  RE02: "deferred reactivate record",
  RE03: "standard reactivate entry",
  RE04: "express reactivate batch",
  RE05: "fragile reactivate route",
  RE06: "bulky reactivate window",
  RE07: "seasonal reactivate policy",
  RE08: "returnable reactivate rule",
  RE09: "perishable reactivate check",
  RE10: "regulated reactivate ticket",
  RE11: "oversized reactivate queue",
  RE12: "premium reactivate slot",
  RE13: "discounted reactivate lane",
  RE14: "limited reactivate tier",
  RE15: "archived reactivate group",
  RE16: "pending reactivate profile",
  RE17: "verified reactivate rate",
  RE18: "flagged reactivate cap",
  RE19: "manual reactivate quota",
  RE20: "automatic reactivate cycle",
  RE21: "partial reactivate ledger",
  RE22: "primary reactivate session",
  RE23: "secondary reactivate contact",
  RE24: "legacy reactivate notice",
};

/** Description of a reactivate code, or "unknown reactivate code: <code>". */
export function describeReactivate(code: string): string {
  return REACTIVATE_CODES[code] ?? `unknown reactivate code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 26, b: 27, c: 28 };

/** Relative weight of a reactivate class; unknown classes weigh nothing. */
export function reactivateWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalReactivateWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + reactivateWeight(key), 0);
}

/** Scales a reactivate amount by the module factor and rounds to a whole number. */
export function reactivateScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function reactivateShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 reactivate" or "3 reactivates". */
export function reactivateLabel(count: number): string {
  return count === 1 ? "1 reactivate" : `${count} reactivates`;
}

export function reactivateSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
