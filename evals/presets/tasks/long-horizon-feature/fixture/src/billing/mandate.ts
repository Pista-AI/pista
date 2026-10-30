// billing: mandate helpers.

/** Known mandate codes and what they mean. */
export const MANDATE_CODES: Record<string, string> = {
  MA01: "deferred mandate batch",
  MA02: "standard mandate route",
  MA03: "express mandate window",
  MA04: "fragile mandate policy",
  MA05: "bulky mandate rule",
  MA06: "seasonal mandate check",
  MA07: "returnable mandate ticket",
  MA08: "perishable mandate queue",
  MA09: "regulated mandate slot",
  MA10: "oversized mandate lane",
  MA11: "premium mandate tier",
  MA12: "discounted mandate group",
  MA13: "limited mandate profile",
  MA14: "archived mandate rate",
  MA15: "pending mandate cap",
  MA16: "verified mandate quota",
  MA17: "flagged mandate cycle",
  MA18: "manual mandate ledger",
  MA19: "automatic mandate session",
  MA20: "partial mandate contact",
  MA21: "primary mandate notice",
  MA22: "secondary mandate plan",
  MA23: "legacy mandate request",
  MA24: "trial mandate record",
};

/** Description of a mandate code, or "unknown mandate code: <code>". */
export function describeMandate(code: string): string {
  return MANDATE_CODES[code] ?? `unknown mandate code: ${code}`;
}

/** Scales a mandate amount by the module factor and rounds to a whole number. */
export function mandateScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function mandateShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 mandate" or "3 mandates". */
export function mandateLabel(count: number): string {
  return count === 1 ? "1 mandate" : `${count} mandates`;
}

export function mandateSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** mandate codes are upper-case and prefixed with their kind. */
export function formatMandate(value: string): string {
  return "MAN-" + value.trim().toUpperCase();
}

/** Inverse of `formatMandate`; undefined when the prefix does not match. */
export function parseMandate(code: string): string | undefined {
  const prefix = "MAN-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
