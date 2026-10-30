// orders: invoice helpers.

/** Known invoice codes and what they mean. */
export const INVOICE_CODES: Record<string, string> = {
  IN01: "pending invoice group",
  IN02: "verified invoice profile",
  IN03: "flagged invoice rate",
  IN04: "manual invoice cap",
  IN05: "automatic invoice quota",
  IN06: "partial invoice cycle",
  IN07: "primary invoice ledger",
  IN08: "secondary invoice session",
  IN09: "legacy invoice contact",
  IN10: "trial invoice notice",
  IN11: "internal invoice plan",
  IN12: "external invoice request",
  IN13: "priority invoice record",
  IN14: "deferred invoice entry",
  IN15: "standard invoice batch",
  IN16: "express invoice route",
  IN17: "fragile invoice window",
  IN18: "bulky invoice policy",
  IN19: "seasonal invoice rule",
  IN20: "returnable invoice check",
  IN21: "perishable invoice ticket",
  IN22: "regulated invoice queue",
  IN23: "oversized invoice slot",
  IN24: "premium invoice lane",
};

/** Description of a invoice code, or "unknown invoice code: <code>". */
export function describeInvoice(code: string): string {
  return INVOICE_CODES[code] ?? `unknown invoice code: ${code}`;
}

/** "1 invoice" or "3 invoices". */
export function invoiceLabel(count: number): string {
  return count === 1 ? "1 invoice" : `${count} invoices`;
}

export function invoiceSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** invoice codes are upper-case and prefixed with their kind. */
export function formatInvoice(value: string): string {
  return "INV-" + value.trim().toUpperCase();
}

/** Inverse of `formatInvoice`; undefined when the prefix does not match. */
export function parseInvoice(code: string): string | undefined {
  const prefix = "INV-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the invoice limits (1 to 113). */
export function isInvoiceValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 113;
}

export function clampInvoice(n: number): number {
  return Math.min(113, Math.max(1, Math.trunc(n)));
}
