// orders: gifting helpers.

/** Known gifting codes and what they mean. */
export const GIFTING_CODES: Record<string, string> = {
  GI01: "limited gifting group",
  GI02: "archived gifting profile",
  GI03: "pending gifting rate",
  GI04: "verified gifting cap",
  GI05: "flagged gifting quota",
  GI06: "manual gifting cycle",
  GI07: "automatic gifting ledger",
  GI08: "partial gifting session",
  GI09: "primary gifting contact",
  GI10: "secondary gifting notice",
  GI11: "legacy gifting plan",
  GI12: "trial gifting request",
  GI13: "internal gifting record",
  GI14: "external gifting entry",
  GI15: "priority gifting batch",
  GI16: "deferred gifting route",
  GI17: "standard gifting window",
  GI18: "express gifting policy",
  GI19: "fragile gifting rule",
  GI20: "bulky gifting check",
  GI21: "seasonal gifting ticket",
  GI22: "returnable gifting queue",
  GI23: "perishable gifting slot",
  GI24: "regulated gifting lane",
};

/** Description of a gifting code, or "unknown gifting code: <code>". */
export function describeGifting(code: string): string {
  return GIFTING_CODES[code] ?? `unknown gifting code: ${code}`;
}

/** "1 gifting" or "3 giftings". */
export function giftingLabel(count: number): string {
  return count === 1 ? "1 gifting" : `${count} giftings`;
}

export function giftingSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** gifting codes are upper-case and prefixed with their kind. */
export function formatGifting(value: string): string {
  return "GIF-" + value.trim().toUpperCase();
}

/** Inverse of `formatGifting`; undefined when the prefix does not match. */
export function parseGifting(code: string): string | undefined {
  const prefix = "GIF-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the gifting limits (2 to 138). */
export function isGiftingValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 138;
}

export function clampGifting(n: number): number {
  return Math.min(138, Math.max(2, Math.trunc(n)));
}
