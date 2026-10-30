// inventory: crate helpers.

/** Known crate codes and what they mean. */
export const CRATE_CODES: Record<string, string> = {
  CR01: "pending crate group",
  CR02: "verified crate profile",
  CR03: "flagged crate rate",
  CR04: "manual crate cap",
  CR05: "automatic crate quota",
  CR06: "partial crate cycle",
  CR07: "primary crate ledger",
  CR08: "secondary crate session",
  CR09: "legacy crate contact",
  CR10: "trial crate notice",
  CR11: "internal crate plan",
  CR12: "external crate request",
  CR13: "priority crate record",
  CR14: "deferred crate entry",
  CR15: "standard crate batch",
  CR16: "express crate route",
  CR17: "fragile crate window",
  CR18: "bulky crate policy",
  CR19: "seasonal crate rule",
  CR20: "returnable crate check",
  CR21: "perishable crate ticket",
  CR22: "regulated crate queue",
  CR23: "oversized crate slot",
  CR24: "premium crate lane",
};

/** Description of a crate code, or "unknown crate code: <code>". */
export function describeCrate(code: string): string {
  return CRATE_CODES[code] ?? `unknown crate code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 14, b: 15, c: 16 };

/** Relative weight of a crate class; unknown classes weigh nothing. */
export function crateWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalCrateWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + crateWeight(key), 0);
}

/** Scales a crate amount by the module factor and rounds to a whole number. */
export function crateScale(value: number, factor = 5): number {
  return Math.round(value * factor);
}

export function crateShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 crate" or "3 crates". */
export function crateLabel(count: number): string {
  return count === 1 ? "1 crate" : `${count} crates`;
}

export function crateSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
