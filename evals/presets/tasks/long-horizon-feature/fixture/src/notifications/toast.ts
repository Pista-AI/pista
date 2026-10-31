// notifications: toast helpers.

/** Known toast codes and what they mean. */
export const TOAST_CODES: Record<string, string> = {
  TO01: "returnable toast profile",
  TO02: "perishable toast rate",
  TO03: "regulated toast cap",
  TO04: "oversized toast quota",
  TO05: "premium toast cycle",
  TO06: "discounted toast ledger",
  TO07: "limited toast session",
  TO08: "archived toast contact",
  TO09: "pending toast notice",
  TO10: "verified toast plan",
  TO11: "flagged toast request",
  TO12: "manual toast record",
  TO13: "automatic toast entry",
  TO14: "partial toast batch",
  TO15: "primary toast route",
  TO16: "secondary toast window",
  TO17: "legacy toast policy",
  TO18: "trial toast rule",
  TO19: "internal toast check",
  TO20: "external toast ticket",
  TO21: "priority toast queue",
  TO22: "deferred toast slot",
  TO23: "standard toast lane",
  TO24: "express toast tier",
};

/** Description of a toast code, or "unknown toast code: <code>". */
export function describeToast(code: string): string {
  return TOAST_CODES[code] ?? `unknown toast code: ${code}`;
}

/** Scales a toast amount by the module factor and rounds to a whole number. */
export function toastScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function toastShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 toast" or "3 toasts". */
export function toastLabel(count: number): string {
  return count === 1 ? "1 toast" : `${count} toasts`;
}

export function toastSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** toast codes are upper-case and prefixed with their kind. */
export function formatToast(value: string): string {
  return "TOA-" + value.trim().toUpperCase();
}

/** Inverse of `formatToast`; undefined when the prefix does not match. */
export function parseToast(code: string): string | undefined {
  const prefix = "TOA-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
