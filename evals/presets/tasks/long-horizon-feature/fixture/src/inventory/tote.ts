// inventory: tote helpers.

/** Known tote codes and what they mean. */
export const TOTE_CODES: Record<string, string> = {
  TO01: "verified tote cap",
  TO02: "flagged tote quota",
  TO03: "manual tote cycle",
  TO04: "automatic tote ledger",
  TO05: "partial tote session",
  TO06: "primary tote contact",
  TO07: "secondary tote notice",
  TO08: "legacy tote plan",
  TO09: "trial tote request",
  TO10: "internal tote record",
  TO11: "external tote entry",
  TO12: "priority tote batch",
  TO13: "deferred tote route",
  TO14: "standard tote window",
  TO15: "express tote policy",
  TO16: "fragile tote rule",
  TO17: "bulky tote check",
  TO18: "seasonal tote ticket",
  TO19: "returnable tote queue",
  TO20: "perishable tote slot",
  TO21: "regulated tote lane",
  TO22: "oversized tote tier",
  TO23: "premium tote group",
  TO24: "discounted tote profile",
};

/** Description of a tote code, or "unknown tote code: <code>". */
export function describeTote(code: string): string {
  return TOTE_CODES[code] ?? `unknown tote code: ${code}`;
}

/** Scales a tote amount by the module factor and rounds to a whole number. */
export function toteScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function toteShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 tote" or "3 totes". */
export function toteLabel(count: number): string {
  return count === 1 ? "1 tote" : `${count} totes`;
}

export function toteSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** tote codes are upper-case and prefixed with their kind. */
export function formatTote(value: string): string {
  return "TOT-" + value.trim().toUpperCase();
}

/** Inverse of `formatTote`; undefined when the prefix does not match. */
export function parseTote(code: string): string | undefined {
  const prefix = "TOT-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
