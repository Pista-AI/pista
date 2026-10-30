// notifications: header helpers.

/** Known header codes and what they mean. */
export const HEADER_CODES: Record<string, string> = {
  HE01: "secondary header queue",
  HE02: "legacy header slot",
  HE03: "trial header lane",
  HE04: "internal header tier",
  HE05: "external header group",
  HE06: "priority header profile",
  HE07: "deferred header rate",
  HE08: "standard header cap",
  HE09: "express header quota",
  HE10: "fragile header cycle",
  HE11: "bulky header ledger",
  HE12: "seasonal header session",
  HE13: "returnable header contact",
  HE14: "perishable header notice",
  HE15: "regulated header plan",
  HE16: "oversized header request",
  HE17: "premium header record",
  HE18: "discounted header entry",
  HE19: "limited header batch",
  HE20: "archived header route",
  HE21: "pending header window",
  HE22: "verified header policy",
  HE23: "flagged header rule",
  HE24: "manual header check",
};

/** Description of a header code, or "unknown header code: <code>". */
export function describeHeader(code: string): string {
  return HEADER_CODES[code] ?? `unknown header code: ${code}`;
}

/** Scales a header amount by the module factor and rounds to a whole number. */
export function headerScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function headerShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 header" or "3 headers". */
export function headerLabel(count: number): string {
  return count === 1 ? "1 header" : `${count} headers`;
}

export function headerSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** header codes are upper-case and prefixed with their kind. */
export function formatHeader(value: string): string {
  return "HEA-" + value.trim().toUpperCase();
}

/** Inverse of `formatHeader`; undefined when the prefix does not match. */
export function parseHeader(code: string): string | undefined {
  const prefix = "HEA-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
