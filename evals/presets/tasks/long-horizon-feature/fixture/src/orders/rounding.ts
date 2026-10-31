// orders: rounding helpers.

/** Known rounding codes and what they mean. */
export const ROUNDING_CODES: Record<string, string> = {
  RO01: "deferred rounding batch",
  RO02: "standard rounding route",
  RO03: "express rounding window",
  RO04: "fragile rounding policy",
  RO05: "bulky rounding rule",
  RO06: "seasonal rounding check",
  RO07: "returnable rounding ticket",
  RO08: "perishable rounding queue",
  RO09: "regulated rounding slot",
  RO10: "oversized rounding lane",
  RO11: "premium rounding tier",
  RO12: "discounted rounding group",
  RO13: "limited rounding profile",
  RO14: "archived rounding rate",
  RO15: "pending rounding cap",
  RO16: "verified rounding quota",
  RO17: "flagged rounding cycle",
  RO18: "manual rounding ledger",
  RO19: "automatic rounding session",
  RO20: "partial rounding contact",
  RO21: "primary rounding notice",
  RO22: "secondary rounding plan",
  RO23: "legacy rounding request",
  RO24: "trial rounding record",
};

/** Description of a rounding code, or "unknown rounding code: <code>". */
export function describeRounding(code: string): string {
  return ROUNDING_CODES[code] ?? `unknown rounding code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 27, b: 28, c: 29 };

/** Relative weight of a rounding class; unknown classes weigh nothing. */
export function roundingWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalRoundingWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + roundingWeight(key), 0);
}

/** Scales a rounding amount by the module factor and rounds to a whole number. */
export function roundingScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function roundingShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 rounding" or "3 roundings". */
export function roundingLabel(count: number): string {
  return count === 1 ? "1 rounding" : `${count} roundings`;
}

export function roundingSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
