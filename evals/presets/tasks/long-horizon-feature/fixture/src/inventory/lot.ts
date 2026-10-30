// inventory: lot helpers.

/** Known lot codes and what they mean. */
export const LOT_CODES: Record<string, string> = {
  LO01: "regulated lot session",
  LO02: "oversized lot contact",
  LO03: "premium lot notice",
  LO04: "discounted lot plan",
  LO05: "limited lot request",
  LO06: "archived lot record",
  LO07: "pending lot entry",
  LO08: "verified lot batch",
  LO09: "flagged lot route",
  LO10: "manual lot window",
  LO11: "automatic lot policy",
  LO12: "partial lot rule",
  LO13: "primary lot check",
  LO14: "secondary lot ticket",
  LO15: "legacy lot queue",
  LO16: "trial lot slot",
  LO17: "internal lot lane",
  LO18: "external lot tier",
  LO19: "priority lot group",
  LO20: "deferred lot profile",
  LO21: "standard lot rate",
  LO22: "express lot cap",
  LO23: "fragile lot quota",
  LO24: "bulky lot cycle",
};

/** Description of a lot code, or "unknown lot code: <code>". */
export function describeLot(code: string): string {
  return LOT_CODES[code] ?? `unknown lot code: ${code}`;
}

/** Whether `n` is a whole number inside the lot limits (3 to 107). */
export function isLotValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 107;
}

export function clampLot(n: number): number {
  return Math.min(107, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 8, b: 9, c: 10 };

/** Relative weight of a lot class; unknown classes weigh nothing. */
export function lotWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalLotWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + lotWeight(key), 0);
}

/** Scales a lot amount by the module factor and rounds to a whole number. */
export function lotScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}

export function lotShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
