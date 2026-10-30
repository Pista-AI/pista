// inventory: drum helpers.

/** Known drum codes and what they mean. */
export const DRUM_CODES: Record<string, string> = {
  DR01: "flagged drum record",
  DR02: "manual drum entry",
  DR03: "automatic drum batch",
  DR04: "partial drum route",
  DR05: "primary drum window",
  DR06: "secondary drum policy",
  DR07: "legacy drum rule",
  DR08: "trial drum check",
  DR09: "internal drum ticket",
  DR10: "external drum queue",
  DR11: "priority drum slot",
  DR12: "deferred drum lane",
  DR13: "standard drum tier",
  DR14: "express drum group",
  DR15: "fragile drum profile",
  DR16: "bulky drum rate",
  DR17: "seasonal drum cap",
  DR18: "returnable drum quota",
  DR19: "perishable drum cycle",
  DR20: "regulated drum ledger",
  DR21: "oversized drum session",
  DR22: "premium drum contact",
  DR23: "discounted drum notice",
  DR24: "limited drum plan",
};

/** Description of a drum code, or "unknown drum code: <code>". */
export function describeDrum(code: string): string {
  return DRUM_CODES[code] ?? `unknown drum code: ${code}`;
}

/** Whether `n` is a whole number inside the drum limits (2 to 142). */
export function isDrumValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 142;
}

export function clampDrum(n: number): number {
  return Math.min(142, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 43, b: 44, c: 45 };

/** Relative weight of a drum class; unknown classes weigh nothing. */
export function drumWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalDrumWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + drumWeight(key), 0);
}

/** Scales a drum amount by the module factor and rounds to a whole number. */
export function drumScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}

export function drumShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
