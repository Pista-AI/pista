// orders: voucher helpers.

/** Known voucher codes and what they mean. */
export const VOUCHER_CODES: Record<string, string> = {
  VO01: "bulky voucher ticket",
  VO02: "seasonal voucher queue",
  VO03: "returnable voucher slot",
  VO04: "perishable voucher lane",
  VO05: "regulated voucher tier",
  VO06: "oversized voucher group",
  VO07: "premium voucher profile",
  VO08: "discounted voucher rate",
  VO09: "limited voucher cap",
  VO10: "archived voucher quota",
  VO11: "pending voucher cycle",
  VO12: "verified voucher ledger",
  VO13: "flagged voucher session",
  VO14: "manual voucher contact",
  VO15: "automatic voucher notice",
  VO16: "partial voucher plan",
  VO17: "primary voucher request",
  VO18: "secondary voucher record",
  VO19: "legacy voucher entry",
  VO20: "trial voucher batch",
  VO21: "internal voucher route",
  VO22: "external voucher window",
  VO23: "priority voucher policy",
  VO24: "deferred voucher rule",
};

/** Description of a voucher code, or "unknown voucher code: <code>". */
export function describeVoucher(code: string): string {
  return VOUCHER_CODES[code] ?? `unknown voucher code: ${code}`;
}

/** "1 voucher" or "3 vouchers". */
export function voucherLabel(count: number): string {
  return count === 1 ? "1 voucher" : `${count} vouchers`;
}

export function voucherSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** voucher codes are upper-case and prefixed with their kind. */
export function formatVoucher(value: string): string {
  return "VOU-" + value.trim().toUpperCase();
}

/** Inverse of `formatVoucher`; undefined when the prefix does not match. */
export function parseVoucher(code: string): string | undefined {
  const prefix = "VOU-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the voucher limits (3 to 103). */
export function isVoucherValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 103;
}

export function clampVoucher(n: number): number {
  return Math.min(103, Math.max(3, Math.trunc(n)));
}
