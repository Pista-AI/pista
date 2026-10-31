// inventory: damage helpers.

/** Known damage codes and what they mean. */
export const DAMAGE_CODES: Record<string, string> = {
  DA01: "express damage ticket",
  DA02: "fragile damage queue",
  DA03: "bulky damage slot",
  DA04: "seasonal damage lane",
  DA05: "returnable damage tier",
  DA06: "perishable damage group",
  DA07: "regulated damage profile",
  DA08: "oversized damage rate",
  DA09: "premium damage cap",
  DA10: "discounted damage quota",
  DA11: "limited damage cycle",
  DA12: "archived damage ledger",
  DA13: "pending damage session",
  DA14: "verified damage contact",
  DA15: "flagged damage notice",
  DA16: "manual damage plan",
  DA17: "automatic damage request",
  DA18: "partial damage record",
  DA19: "primary damage entry",
  DA20: "secondary damage batch",
  DA21: "legacy damage route",
  DA22: "trial damage window",
  DA23: "internal damage policy",
  DA24: "external damage rule",
};

/** Description of a damage code, or "unknown damage code: <code>". */
export function describeDamage(code: string): string {
  return DAMAGE_CODES[code] ?? `unknown damage code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 29, b: 30, c: 31 };

/** Relative weight of a damage class; unknown classes weigh nothing. */
export function damageWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalDamageWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + damageWeight(key), 0);
}

/** Scales a damage amount by the module factor and rounds to a whole number. */
export function damageScale(value: number, factor = 5): number {
  return Math.round(value * factor);
}

export function damageShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 damage" or "3 damages". */
export function damageLabel(count: number): string {
  return count === 1 ? "1 damage" : `${count} damages`;
}

export function damageSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
