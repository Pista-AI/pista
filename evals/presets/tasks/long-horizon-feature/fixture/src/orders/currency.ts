// orders: currency helpers.

/** Known currency codes and what they mean. */
export const CURRENCY_CODES: Record<string, string> = {
  CU01: "standard currency policy",
  CU02: "express currency rule",
  CU03: "fragile currency check",
  CU04: "bulky currency ticket",
  CU05: "seasonal currency queue",
  CU06: "returnable currency slot",
  CU07: "perishable currency lane",
  CU08: "regulated currency tier",
  CU09: "oversized currency group",
  CU10: "premium currency profile",
  CU11: "discounted currency rate",
  CU12: "limited currency cap",
  CU13: "archived currency quota",
  CU14: "pending currency cycle",
  CU15: "verified currency ledger",
  CU16: "flagged currency session",
  CU17: "manual currency contact",
  CU18: "automatic currency notice",
  CU19: "partial currency plan",
  CU20: "primary currency request",
  CU21: "secondary currency record",
  CU22: "legacy currency entry",
  CU23: "trial currency batch",
  CU24: "internal currency route",
};

/** Description of a currency code, or "unknown currency code: <code>". */
export function describeCurrency(code: string): string {
  return CURRENCY_CODES[code] ?? `unknown currency code: ${code}`;
}

/** Scales a currency amount by the module factor and rounds to a whole number. */
export function currencyScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}

export function currencyShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 currency" or "3 currencys". */
export function currencyLabel(count: number): string {
  return count === 1 ? "1 currency" : `${count} currencys`;
}

export function currencySummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** currency codes are upper-case and prefixed with their kind. */
export function formatCurrency(value: string): string {
  return "CUR-" + value.trim().toUpperCase();
}

/** Inverse of `formatCurrency`; undefined when the prefix does not match. */
export function parseCurrency(code: string): string | undefined {
  const prefix = "CUR-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
