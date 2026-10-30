// notifications: reminder helpers.

/** Known reminder codes and what they mean. */
export const REMINDER_CODES: Record<string, string> = {
  RE01: "internal reminder cycle",
  RE02: "external reminder ledger",
  RE03: "priority reminder session",
  RE04: "deferred reminder contact",
  RE05: "standard reminder notice",
  RE06: "express reminder plan",
  RE07: "fragile reminder request",
  RE08: "bulky reminder record",
  RE09: "seasonal reminder entry",
  RE10: "returnable reminder batch",
  RE11: "perishable reminder route",
  RE12: "regulated reminder window",
  RE13: "oversized reminder policy",
  RE14: "premium reminder rule",
  RE15: "discounted reminder check",
  RE16: "limited reminder ticket",
  RE17: "archived reminder queue",
  RE18: "pending reminder slot",
  RE19: "verified reminder lane",
  RE20: "flagged reminder tier",
  RE21: "manual reminder group",
  RE22: "automatic reminder profile",
  RE23: "partial reminder rate",
  RE24: "primary reminder cap",
};

/** Description of a reminder code, or "unknown reminder code: <code>". */
export function describeReminder(code: string): string {
  return REMINDER_CODES[code] ?? `unknown reminder code: ${code}`;
}

/** Whether `n` is a whole number inside the reminder limits (3 to 123). */
export function isReminderValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 123;
}

export function clampReminder(n: number): number {
  return Math.min(123, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 24, b: 25, c: 26 };

/** Relative weight of a reminder class; unknown classes weigh nothing. */
export function reminderWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalReminderWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + reminderWeight(key), 0);
}

/** Scales a reminder amount by the module factor and rounds to a whole number. */
export function reminderScale(value: number, factor = 5): number {
  return Math.round(value * factor);
}

export function reminderShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
