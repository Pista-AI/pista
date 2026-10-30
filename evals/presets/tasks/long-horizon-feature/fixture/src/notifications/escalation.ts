// notifications: escalation helpers.

/** Known escalation codes and what they mean. */
export const ESCALATION_CODES: Record<string, string> = {
  ES01: "priority escalation request",
  ES02: "deferred escalation record",
  ES03: "standard escalation entry",
  ES04: "express escalation batch",
  ES05: "fragile escalation route",
  ES06: "bulky escalation window",
  ES07: "seasonal escalation policy",
  ES08: "returnable escalation rule",
  ES09: "perishable escalation check",
  ES10: "regulated escalation ticket",
  ES11: "oversized escalation queue",
  ES12: "premium escalation slot",
  ES13: "discounted escalation lane",
  ES14: "limited escalation tier",
  ES15: "archived escalation group",
  ES16: "pending escalation profile",
  ES17: "verified escalation rate",
  ES18: "flagged escalation cap",
  ES19: "manual escalation quota",
  ES20: "automatic escalation cycle",
  ES21: "partial escalation ledger",
  ES22: "primary escalation session",
  ES23: "secondary escalation contact",
  ES24: "legacy escalation notice",
};

/** Description of a escalation code, or "unknown escalation code: <code>". */
export function describeEscalation(code: string): string {
  return ESCALATION_CODES[code] ?? `unknown escalation code: ${code}`;
}

/** Scales a escalation amount by the module factor and rounds to a whole number. */
export function escalationScale(value: number, factor = 2): number {
  return Math.round(value * factor);
}

export function escalationShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 escalation" or "3 escalations". */
export function escalationLabel(count: number): string {
  return count === 1 ? "1 escalation" : `${count} escalations`;
}

export function escalationSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** escalation codes are upper-case and prefixed with their kind. */
export function formatEscalation(value: string): string {
  return "ESC-" + value.trim().toUpperCase();
}

/** Inverse of `formatEscalation`; undefined when the prefix does not match. */
export function parseEscalation(code: string): string | undefined {
  const prefix = "ESC-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
