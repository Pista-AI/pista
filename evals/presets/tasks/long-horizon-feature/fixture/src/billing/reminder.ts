// billing: reminder helpers.

/** Known reminder codes and what they mean. */
export const REMINDER_CODES: Record<string, string> = {
  RE01: "flagged reminder ledger",
  RE02: "manual reminder session",
  RE03: "automatic reminder contact",
  RE04: "partial reminder notice",
  RE05: "primary reminder plan",
  RE06: "secondary reminder request",
  RE07: "legacy reminder record",
  RE08: "trial reminder entry",
  RE09: "internal reminder batch",
  RE10: "external reminder route",
  RE11: "priority reminder window",
  RE12: "deferred reminder policy",
  RE13: "standard reminder rule",
  RE14: "express reminder check",
  RE15: "fragile reminder ticket",
  RE16: "bulky reminder queue",
  RE17: "seasonal reminder slot",
  RE18: "returnable reminder lane",
  RE19: "perishable reminder tier",
  RE20: "regulated reminder group",
  RE21: "oversized reminder profile",
  RE22: "premium reminder rate",
  RE23: "discounted reminder cap",
  RE24: "limited reminder quota",
};

/** Description of a reminder code, or "unknown reminder code: <code>". */
export function describeReminder(code: string): string {
  return REMINDER_CODES[code] ?? `unknown reminder code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 16, b: 17, c: 18 };

/** Relative weight of a reminder class; unknown classes weigh nothing. */
export function reminderWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalReminderWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + reminderWeight(key), 0);
}

/** Scales a reminder amount by the module factor and rounds to a whole number. */
export function reminderScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function reminderShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 reminder" or "3 reminders". */
export function reminderLabel(count: number): string {
  return count === 1 ? "1 reminder" : `${count} reminders`;
}

export function reminderSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
