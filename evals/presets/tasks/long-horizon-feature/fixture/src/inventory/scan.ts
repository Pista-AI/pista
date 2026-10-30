// inventory: scan helpers.

/** Known scan codes and what they mean. */
export const SCAN_CODES: Record<string, string> = {
  SC01: "primary scan rule",
  SC02: "secondary scan check",
  SC03: "legacy scan ticket",
  SC04: "trial scan queue",
  SC05: "internal scan slot",
  SC06: "external scan lane",
  SC07: "priority scan tier",
  SC08: "deferred scan group",
  SC09: "standard scan profile",
  SC10: "express scan rate",
  SC11: "fragile scan cap",
  SC12: "bulky scan quota",
  SC13: "seasonal scan cycle",
  SC14: "returnable scan ledger",
  SC15: "perishable scan session",
  SC16: "regulated scan contact",
  SC17: "oversized scan notice",
  SC18: "premium scan plan",
  SC19: "discounted scan request",
  SC20: "limited scan record",
  SC21: "archived scan entry",
  SC22: "pending scan batch",
  SC23: "verified scan route",
  SC24: "flagged scan window",
};

/** Description of a scan code, or "unknown scan code: <code>". */
export function describeScan(code: string): string {
  return SCAN_CODES[code] ?? `unknown scan code: ${code}`;
}

/** Scales a scan amount by the module factor and rounds to a whole number. */
export function scanScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function scanShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 scan" or "3 scans". */
export function scanLabel(count: number): string {
  return count === 1 ? "1 scan" : `${count} scans`;
}

export function scanSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** scan codes are upper-case and prefixed with their kind. */
export function formatScan(value: string): string {
  return "SCA-" + value.trim().toUpperCase();
}

/** Inverse of `formatScan`; undefined when the prefix does not match. */
export function parseScan(code: string): string | undefined {
  const prefix = "SCA-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
