// inventory: serial helpers.

/** Known serial codes and what they mean. */
export const SERIAL_CODES: Record<string, string> = {
  SE01: "premium serial entry",
  SE02: "discounted serial batch",
  SE03: "limited serial route",
  SE04: "archived serial window",
  SE05: "pending serial policy",
  SE06: "verified serial rule",
  SE07: "flagged serial check",
  SE08: "manual serial ticket",
  SE09: "automatic serial queue",
  SE10: "partial serial slot",
  SE11: "primary serial lane",
  SE12: "secondary serial tier",
  SE13: "legacy serial group",
  SE14: "trial serial profile",
  SE15: "internal serial rate",
  SE16: "external serial cap",
  SE17: "priority serial quota",
  SE18: "deferred serial cycle",
  SE19: "standard serial ledger",
  SE20: "express serial session",
  SE21: "fragile serial contact",
  SE22: "bulky serial notice",
  SE23: "seasonal serial plan",
  SE24: "returnable serial request",
};

/** Description of a serial code, or "unknown serial code: <code>". */
export function describeSerial(code: string): string {
  return SERIAL_CODES[code] ?? `unknown serial code: ${code}`;
}

/** Scales a serial amount by the module factor and rounds to a whole number. */
export function serialScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function serialShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 serial" or "3 serials". */
export function serialLabel(count: number): string {
  return count === 1 ? "1 serial" : `${count} serials`;
}

export function serialSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** serial codes are upper-case and prefixed with their kind. */
export function formatSerial(value: string): string {
  return "SER-" + value.trim().toUpperCase();
}

/** Inverse of `formatSerial`; undefined when the prefix does not match. */
export function parseSerial(code: string): string | undefined {
  const prefix = "SER-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
