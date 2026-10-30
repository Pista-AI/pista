// reports: region helpers.

/** Known region codes and what they mean. */
export const REGION_CODES: Record<string, string> = {
  RE01: "secondary region queue",
  RE02: "legacy region slot",
  RE03: "trial region lane",
  RE04: "internal region tier",
  RE05: "external region group",
  RE06: "priority region profile",
  RE07: "deferred region rate",
  RE08: "standard region cap",
  RE09: "express region quota",
  RE10: "fragile region cycle",
  RE11: "bulky region ledger",
  RE12: "seasonal region session",
  RE13: "returnable region contact",
  RE14: "perishable region notice",
  RE15: "regulated region plan",
  RE16: "oversized region request",
  RE17: "premium region record",
  RE18: "discounted region entry",
  RE19: "limited region batch",
  RE20: "archived region route",
  RE21: "pending region window",
  RE22: "verified region policy",
  RE23: "flagged region rule",
  RE24: "manual region check",
};

/** Description of a region code, or "unknown region code: <code>". */
export function describeRegion(code: string): string {
  return REGION_CODES[code] ?? `unknown region code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 21, b: 22, c: 23 };

/** Relative weight of a region class; unknown classes weigh nothing. */
export function regionWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalRegionWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + regionWeight(key), 0);
}

/** Scales a region amount by the module factor and rounds to a whole number. */
export function regionScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function regionShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 region" or "3 regions". */
export function regionLabel(count: number): string {
  return count === 1 ? "1 region" : `${count} regions`;
}

export function regionSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
