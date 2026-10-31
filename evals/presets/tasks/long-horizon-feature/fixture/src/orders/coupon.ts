// orders: coupon helpers.

/** Known coupon codes and what they mean. */
export const COUPON_CODES: Record<string, string> = {
  CO01: "fragile coupon policy",
  CO02: "bulky coupon rule",
  CO03: "seasonal coupon check",
  CO04: "returnable coupon ticket",
  CO05: "perishable coupon queue",
  CO06: "regulated coupon slot",
  CO07: "oversized coupon lane",
  CO08: "premium coupon tier",
  CO09: "discounted coupon group",
  CO10: "limited coupon profile",
  CO11: "archived coupon rate",
  CO12: "pending coupon cap",
  CO13: "verified coupon quota",
  CO14: "flagged coupon cycle",
  CO15: "manual coupon ledger",
  CO16: "automatic coupon session",
  CO17: "partial coupon contact",
  CO18: "primary coupon notice",
  CO19: "secondary coupon plan",
  CO20: "legacy coupon request",
  CO21: "trial coupon record",
  CO22: "internal coupon entry",
  CO23: "external coupon batch",
  CO24: "priority coupon route",
};

/** Description of a coupon code, or "unknown coupon code: <code>". */
export function describeCoupon(code: string): string {
  return COUPON_CODES[code] ?? `unknown coupon code: ${code}`;
}

/** Scales a coupon amount by the module factor and rounds to a whole number. */
export function couponScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}

export function couponShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 coupon" or "3 coupons". */
export function couponLabel(count: number): string {
  return count === 1 ? "1 coupon" : `${count} coupons`;
}

export function couponSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** coupon codes are upper-case and prefixed with their kind. */
export function formatCoupon(value: string): string {
  return "COU-" + value.trim().toUpperCase();
}

/** Inverse of `formatCoupon`; undefined when the prefix does not match. */
export function parseCoupon(code: string): string | undefined {
  const prefix = "COU-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
