// orders: label-print helpers.

/** Known label-print codes and what they mean. */
export const LABEL_PRINT_CODES: Record<string, string> = {
  LA01: "discounted label-print slot",
  LA02: "limited label-print lane",
  LA03: "archived label-print tier",
  LA04: "pending label-print group",
  LA05: "verified label-print profile",
  LA06: "flagged label-print rate",
  LA07: "manual label-print cap",
  LA08: "automatic label-print quota",
  LA09: "partial label-print cycle",
  LA10: "primary label-print ledger",
  LA11: "secondary label-print session",
  LA12: "legacy label-print contact",
  LA13: "trial label-print notice",
  LA14: "internal label-print plan",
  LA15: "external label-print request",
  LA16: "priority label-print record",
  LA17: "deferred label-print entry",
  LA18: "standard label-print batch",
  LA19: "express label-print route",
  LA20: "fragile label-print window",
  LA21: "bulky label-print policy",
  LA22: "seasonal label-print rule",
  LA23: "returnable label-print check",
  LA24: "perishable label-print ticket",
};

/** Description of a label-print code, or "unknown label-print code: <code>". */
export function describeLabelPrint(code: string): string {
  return LABEL_PRINT_CODES[code] ?? `unknown label-print code: ${code}`;
}

/** Scales a label-print amount by the module factor and rounds to a whole number. */
export function labelPrintScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}

export function labelPrintShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 label-print" or "3 label-prints". */
export function labelPrintLabel(count: number): string {
  return count === 1 ? "1 label-print" : `${count} label-prints`;
}

export function labelPrintSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** label-print codes are upper-case and prefixed with their kind. */
export function formatLabelPrint(value: string): string {
  return "LAB-" + value.trim().toUpperCase();
}

/** Inverse of `formatLabelPrint`; undefined when the prefix does not match. */
export function parseLabelPrint(code: string): string | undefined {
  const prefix = "LAB-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
