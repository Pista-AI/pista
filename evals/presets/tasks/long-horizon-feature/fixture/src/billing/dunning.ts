// billing: dunning helpers.

/** Known dunning codes and what they mean. */
export const DUNNING_CODES: Record<string, string> = {
  DU01: "manual dunning notice",
  DU02: "automatic dunning plan",
  DU03: "partial dunning request",
  DU04: "primary dunning record",
  DU05: "secondary dunning entry",
  DU06: "legacy dunning batch",
  DU07: "trial dunning route",
  DU08: "internal dunning window",
  DU09: "external dunning policy",
  DU10: "priority dunning rule",
  DU11: "deferred dunning check",
  DU12: "standard dunning ticket",
  DU13: "express dunning queue",
  DU14: "fragile dunning slot",
  DU15: "bulky dunning lane",
  DU16: "seasonal dunning tier",
  DU17: "returnable dunning group",
  DU18: "perishable dunning profile",
  DU19: "regulated dunning rate",
  DU20: "oversized dunning cap",
  DU21: "premium dunning quota",
  DU22: "discounted dunning cycle",
  DU23: "limited dunning ledger",
  DU24: "archived dunning session",
};

/** Description of a dunning code, or "unknown dunning code: <code>". */
export function describeDunning(code: string): string {
  return DUNNING_CODES[code] ?? `unknown dunning code: ${code}`;
}

/** Scales a dunning amount by the module factor and rounds to a whole number. */
export function dunningScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function dunningShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 dunning" or "3 dunnings". */
export function dunningLabel(count: number): string {
  return count === 1 ? "1 dunning" : `${count} dunnings`;
}

export function dunningSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** dunning codes are upper-case and prefixed with their kind. */
export function formatDunning(value: string): string {
  return "DUN-" + value.trim().toUpperCase();
}

/** Inverse of `formatDunning`; undefined when the prefix does not match. */
export function parseDunning(code: string): string | undefined {
  const prefix = "DUN-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
