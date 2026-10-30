// billing: interest helpers.

/** Known interest codes and what they mean. */
export const INTEREST_CODES: Record<string, string> = {
  IN01: "limited interest check",
  IN02: "archived interest ticket",
  IN03: "pending interest queue",
  IN04: "verified interest slot",
  IN05: "flagged interest lane",
  IN06: "manual interest tier",
  IN07: "automatic interest group",
  IN08: "partial interest profile",
  IN09: "primary interest rate",
  IN10: "secondary interest cap",
  IN11: "legacy interest quota",
  IN12: "trial interest cycle",
  IN13: "internal interest ledger",
  IN14: "external interest session",
  IN15: "priority interest contact",
  IN16: "deferred interest notice",
  IN17: "standard interest plan",
  IN18: "express interest request",
  IN19: "fragile interest record",
  IN20: "bulky interest entry",
  IN21: "seasonal interest batch",
  IN22: "returnable interest route",
  IN23: "perishable interest window",
  IN24: "regulated interest policy",
};

/** Description of a interest code, or "unknown interest code: <code>". */
export function describeInterest(code: string): string {
  return INTEREST_CODES[code] ?? `unknown interest code: ${code}`;
}

/** Scales a interest amount by the module factor and rounds to a whole number. */
export function interestScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function interestShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 interest" or "3 interests". */
export function interestLabel(count: number): string {
  return count === 1 ? "1 interest" : `${count} interests`;
}

export function interestSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** interest codes are upper-case and prefixed with their kind. */
export function formatInterest(value: string): string {
  return "INT-" + value.trim().toUpperCase();
}

/** Inverse of `formatInterest`; undefined when the prefix does not match. */
export function parseInterest(code: string): string | undefined {
  const prefix = "INT-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
