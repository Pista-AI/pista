// inventory: strap helpers.

/** Known strap codes and what they mean. */
export const STRAP_CODES: Record<string, string> = {
  ST01: "archived strap cap",
  ST02: "pending strap quota",
  ST03: "verified strap cycle",
  ST04: "flagged strap ledger",
  ST05: "manual strap session",
  ST06: "automatic strap contact",
  ST07: "partial strap notice",
  ST08: "primary strap plan",
  ST09: "secondary strap request",
  ST10: "legacy strap record",
  ST11: "trial strap entry",
  ST12: "internal strap batch",
  ST13: "external strap route",
  ST14: "priority strap window",
  ST15: "deferred strap policy",
  ST16: "standard strap rule",
  ST17: "express strap check",
  ST18: "fragile strap ticket",
  ST19: "bulky strap queue",
  ST20: "seasonal strap slot",
  ST21: "returnable strap lane",
  ST22: "perishable strap tier",
  ST23: "regulated strap group",
  ST24: "oversized strap profile",
};

/** Description of a strap code, or "unknown strap code: <code>". */
export function describeStrap(code: string): string {
  return STRAP_CODES[code] ?? `unknown strap code: ${code}`;
}

/** Scales a strap amount by the module factor and rounds to a whole number. */
export function strapScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function strapShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 strap" or "3 straps". */
export function strapLabel(count: number): string {
  return count === 1 ? "1 strap" : `${count} straps`;
}

export function strapSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** strap codes are upper-case and prefixed with their kind. */
export function formatStrap(value: string): string {
  return "STR-" + value.trim().toUpperCase();
}

/** Inverse of `formatStrap`; undefined when the prefix does not match. */
export function parseStrap(code: string): string | undefined {
  const prefix = "STR-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
