// inventory: slot helpers.

/** Known slot codes and what they mean. */
export const SLOT_CODES: Record<string, string> = {
  SL01: "automatic slot record",
  SL02: "partial slot entry",
  SL03: "primary slot batch",
  SL04: "secondary slot route",
  SL05: "legacy slot window",
  SL06: "trial slot policy",
  SL07: "internal slot rule",
  SL08: "external slot check",
  SL09: "priority slot ticket",
  SL10: "deferred slot queue",
  SL11: "standard slot slot",
  SL12: "express slot lane",
  SL13: "fragile slot tier",
  SL14: "bulky slot group",
  SL15: "seasonal slot profile",
  SL16: "returnable slot rate",
  SL17: "perishable slot cap",
  SL18: "regulated slot quota",
  SL19: "oversized slot cycle",
  SL20: "premium slot ledger",
  SL21: "discounted slot session",
  SL22: "limited slot contact",
  SL23: "archived slot notice",
  SL24: "pending slot plan",
};

/** Description of a slot code, or "unknown slot code: <code>". */
export function describeSlot(code: string): string {
  return SLOT_CODES[code] ?? `unknown slot code: ${code}`;
}

/** Whether `n` is a whole number inside the slot limits (1 to 117). */
export function isSlotValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 117;
}

export function clampSlot(n: number): number {
  return Math.min(117, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 18, b: 19, c: 20 };

/** Relative weight of a slot class; unknown classes weigh nothing. */
export function slotWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalSlotWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + slotWeight(key), 0);
}

/** Scales a slot amount by the module factor and rounds to a whole number. */
export function slotScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}

export function slotShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
