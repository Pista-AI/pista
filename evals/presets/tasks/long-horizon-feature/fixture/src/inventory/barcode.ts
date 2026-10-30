// inventory: barcode helpers.

/** Known barcode codes and what they mean. */
export const BARCODE_CODES: Record<string, string> = {
  BA01: "discounted barcode window",
  BA02: "limited barcode policy",
  BA03: "archived barcode rule",
  BA04: "pending barcode check",
  BA05: "verified barcode ticket",
  BA06: "flagged barcode queue",
  BA07: "manual barcode slot",
  BA08: "automatic barcode lane",
  BA09: "partial barcode tier",
  BA10: "primary barcode group",
  BA11: "secondary barcode profile",
  BA12: "legacy barcode rate",
  BA13: "trial barcode cap",
  BA14: "internal barcode quota",
  BA15: "external barcode cycle",
  BA16: "priority barcode ledger",
  BA17: "deferred barcode session",
  BA18: "standard barcode contact",
  BA19: "express barcode notice",
  BA20: "fragile barcode plan",
  BA21: "bulky barcode request",
  BA22: "seasonal barcode record",
  BA23: "returnable barcode entry",
  BA24: "perishable barcode batch",
};

/** Description of a barcode code, or "unknown barcode code: <code>". */
export function describeBarcode(code: string): string {
  return BARCODE_CODES[code] ?? `unknown barcode code: ${code}`;
}

/** "1 barcode" or "3 barcodes". */
export function barcodeLabel(count: number): string {
  return count === 1 ? "1 barcode" : `${count} barcodes`;
}

export function barcodeSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** barcode codes are upper-case and prefixed with their kind. */
export function formatBarcode(value: string): string {
  return "BAR-" + value.trim().toUpperCase();
}

/** Inverse of `formatBarcode`; undefined when the prefix does not match. */
export function parseBarcode(code: string): string | undefined {
  const prefix = "BAR-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the barcode limits (2 to 110). */
export function isBarcodeValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 110;
}

export function clampBarcode(n: number): number {
  return Math.min(110, Math.max(2, Math.trunc(n)));
}
