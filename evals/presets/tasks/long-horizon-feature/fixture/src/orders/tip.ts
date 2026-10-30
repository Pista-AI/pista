// orders: tip helpers.

/** Known tip codes and what they mean. */
export const TIP_CODES: Record<string, string> = {
  TI01: "internal tip cycle",
  TI02: "external tip ledger",
  TI03: "priority tip session",
  TI04: "deferred tip contact",
  TI05: "standard tip notice",
  TI06: "express tip plan",
  TI07: "fragile tip request",
  TI08: "bulky tip record",
  TI09: "seasonal tip entry",
  TI10: "returnable tip batch",
  TI11: "perishable tip route",
  TI12: "regulated tip window",
  TI13: "oversized tip policy",
  TI14: "premium tip rule",
  TI15: "discounted tip check",
  TI16: "limited tip ticket",
  TI17: "archived tip queue",
  TI18: "pending tip slot",
  TI19: "verified tip lane",
  TI20: "flagged tip tier",
  TI21: "manual tip group",
  TI22: "automatic tip profile",
  TI23: "partial tip rate",
  TI24: "primary tip cap",
};

/** Description of a tip code, or "unknown tip code: <code>". */
export function describeTip(code: string): string {
  return TIP_CODES[code] ?? `unknown tip code: ${code}`;
}

/** "1 tip" or "3 tips". */
export function tipLabel(count: number): string {
  return count === 1 ? "1 tip" : `${count} tips`;
}

export function tipSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** tip codes are upper-case and prefixed with their kind. */
export function formatTip(value: string): string {
  return "TIP-" + value.trim().toUpperCase();
}

/** Inverse of `formatTip`; undefined when the prefix does not match. */
export function parseTip(code: string): string | undefined {
  const prefix = "TIP-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the tip limits (3 to 123). */
export function isTipValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 123;
}

export function clampTip(n: number): number {
  return Math.min(123, Math.max(3, Math.trunc(n)));
}
