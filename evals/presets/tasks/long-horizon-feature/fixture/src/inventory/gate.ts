// inventory: gate helpers.

/** Known gate codes and what they mean. */
export const GATE_CODES: Record<string, string> = {
  GA01: "perishable gate plan",
  GA02: "regulated gate request",
  GA03: "oversized gate record",
  GA04: "premium gate entry",
  GA05: "discounted gate batch",
  GA06: "limited gate route",
  GA07: "archived gate window",
  GA08: "pending gate policy",
  GA09: "verified gate rule",
  GA10: "flagged gate check",
  GA11: "manual gate ticket",
  GA12: "automatic gate queue",
  GA13: "partial gate slot",
  GA14: "primary gate lane",
  GA15: "secondary gate tier",
  GA16: "legacy gate group",
  GA17: "trial gate profile",
  GA18: "internal gate rate",
  GA19: "external gate cap",
  GA20: "priority gate quota",
  GA21: "deferred gate cycle",
  GA22: "standard gate ledger",
  GA23: "express gate session",
  GA24: "fragile gate contact",
};

/** Description of a gate code, or "unknown gate code: <code>". */
export function describeGate(code: string): string {
  return GATE_CODES[code] ?? `unknown gate code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 34, b: 35, c: 36 };

/** Relative weight of a gate class; unknown classes weigh nothing. */
export function gateWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalGateWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + gateWeight(key), 0);
}

/** Scales a gate amount by the module factor and rounds to a whole number. */
export function gateScale(value: number, factor = 5): number {
  return Math.round(value * factor);
}

export function gateShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 gate" or "3 gates". */
export function gateLabel(count: number): string {
  return count === 1 ? "1 gate" : `${count} gates`;
}

export function gateSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
