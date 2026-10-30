// billing: fraud helpers.

/** Known fraud codes and what they mean. */
export const FRAUD_CODES: Record<string, string> = {
  FR01: "bulky fraud profile",
  FR02: "seasonal fraud rate",
  FR03: "returnable fraud cap",
  FR04: "perishable fraud quota",
  FR05: "regulated fraud cycle",
  FR06: "oversized fraud ledger",
  FR07: "premium fraud session",
  FR08: "discounted fraud contact",
  FR09: "limited fraud notice",
  FR10: "archived fraud plan",
  FR11: "pending fraud request",
  FR12: "verified fraud record",
  FR13: "flagged fraud entry",
  FR14: "manual fraud batch",
  FR15: "automatic fraud route",
  FR16: "partial fraud window",
  FR17: "primary fraud policy",
  FR18: "secondary fraud rule",
  FR19: "legacy fraud check",
  FR20: "trial fraud ticket",
  FR21: "internal fraud queue",
  FR22: "external fraud slot",
  FR23: "priority fraud lane",
  FR24: "deferred fraud tier",
};

/** Description of a fraud code, or "unknown fraud code: <code>". */
export function describeFraud(code: string): string {
  return FRAUD_CODES[code] ?? `unknown fraud code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 31, b: 32, c: 33 };

/** Relative weight of a fraud class; unknown classes weigh nothing. */
export function fraudWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalFraudWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + fraudWeight(key), 0);
}

/** Scales a fraud amount by the module factor and rounds to a whole number. */
export function fraudScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function fraudShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 fraud" or "3 frauds". */
export function fraudLabel(count: number): string {
  return count === 1 ? "1 fraud" : `${count} frauds`;
}

export function fraudSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
