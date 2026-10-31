// orders: duty helpers.

/** Known duty codes and what they mean. */
export const DUTY_CODES: Record<string, string> = {
  DU01: "trial duty rate",
  DU02: "internal duty cap",
  DU03: "external duty quota",
  DU04: "priority duty cycle",
  DU05: "deferred duty ledger",
  DU06: "standard duty session",
  DU07: "express duty contact",
  DU08: "fragile duty notice",
  DU09: "bulky duty plan",
  DU10: "seasonal duty request",
  DU11: "returnable duty record",
  DU12: "perishable duty entry",
  DU13: "regulated duty batch",
  DU14: "oversized duty route",
  DU15: "premium duty window",
  DU16: "discounted duty policy",
  DU17: "limited duty rule",
  DU18: "archived duty check",
  DU19: "pending duty ticket",
  DU20: "verified duty queue",
  DU21: "flagged duty slot",
  DU22: "manual duty lane",
  DU23: "automatic duty tier",
  DU24: "partial duty group",
};

/** Description of a duty code, or "unknown duty code: <code>". */
export function describeDuty(code: string): string {
  return DUTY_CODES[code] ?? `unknown duty code: ${code}`;
}

/** Scales a duty amount by the module factor and rounds to a whole number. */
export function dutyScale(value: number, factor = 4): number {
  return Math.round(value * factor);
}

export function dutyShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 duty" or "3 dutys". */
export function dutyLabel(count: number): string {
  return count === 1 ? "1 duty" : `${count} dutys`;
}

export function dutySummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** duty codes are upper-case and prefixed with their kind. */
export function formatDuty(value: string): string {
  return "DUT-" + value.trim().toUpperCase();
}

/** Inverse of `formatDuty`; undefined when the prefix does not match. */
export function parseDuty(code: string): string | undefined {
  const prefix = "DUT-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
