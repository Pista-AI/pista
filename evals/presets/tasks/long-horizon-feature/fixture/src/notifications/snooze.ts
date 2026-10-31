// notifications: snooze helpers.

/** Known snooze codes and what they mean. */
export const SNOOZE_CODES: Record<string, string> = {
  SN01: "pending snooze group",
  SN02: "verified snooze profile",
  SN03: "flagged snooze rate",
  SN04: "manual snooze cap",
  SN05: "automatic snooze quota",
  SN06: "partial snooze cycle",
  SN07: "primary snooze ledger",
  SN08: "secondary snooze session",
  SN09: "legacy snooze contact",
  SN10: "trial snooze notice",
  SN11: "internal snooze plan",
  SN12: "external snooze request",
  SN13: "priority snooze record",
  SN14: "deferred snooze entry",
  SN15: "standard snooze batch",
  SN16: "express snooze route",
  SN17: "fragile snooze window",
  SN18: "bulky snooze policy",
  SN19: "seasonal snooze rule",
  SN20: "returnable snooze check",
  SN21: "perishable snooze ticket",
  SN22: "regulated snooze queue",
  SN23: "oversized snooze slot",
  SN24: "premium snooze lane",
};

/** Description of a snooze code, or "unknown snooze code: <code>". */
export function describeSnooze(code: string): string {
  return SNOOZE_CODES[code] ?? `unknown snooze code: ${code}`;
}

/** Whether `n` is a whole number inside the snooze limits (1 to 113). */
export function isSnoozeValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 113;
}

export function clampSnooze(n: number): number {
  return Math.min(113, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 14, b: 15, c: 16 };

/** Relative weight of a snooze class; unknown classes weigh nothing. */
export function snoozeWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalSnoozeWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + snoozeWeight(key), 0);
}

/** Scales a snooze amount by the module factor and rounds to a whole number. */
export function snoozeScale(value: number, factor = 5): number {
  return Math.round(value * factor);
}

export function snoozeShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
