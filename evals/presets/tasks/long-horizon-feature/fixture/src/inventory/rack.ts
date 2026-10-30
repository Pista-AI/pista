// inventory: rack helpers.

/** Known rack codes and what they mean. */
export const RACK_CODES: Record<string, string> = {
  RA01: "flagged rack ledger",
  RA02: "manual rack session",
  RA03: "automatic rack contact",
  RA04: "partial rack notice",
  RA05: "primary rack plan",
  RA06: "secondary rack request",
  RA07: "legacy rack record",
  RA08: "trial rack entry",
  RA09: "internal rack batch",
  RA10: "external rack route",
  RA11: "priority rack window",
  RA12: "deferred rack policy",
  RA13: "standard rack rule",
  RA14: "express rack check",
  RA15: "fragile rack ticket",
  RA16: "bulky rack queue",
  RA17: "seasonal rack slot",
  RA18: "returnable rack lane",
  RA19: "perishable rack tier",
  RA20: "regulated rack group",
  RA21: "oversized rack profile",
  RA22: "premium rack rate",
  RA23: "discounted rack cap",
  RA24: "limited rack quota",
};

/** Description of a rack code, or "unknown rack code: <code>". */
export function describeRack(code: string): string {
  return RACK_CODES[code] ?? `unknown rack code: ${code}`;
}

/** "1 rack" or "3 racks". */
export function rackLabel(count: number): string {
  return count === 1 ? "1 rack" : `${count} racks`;
}

export function rackSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** rack codes are upper-case and prefixed with their kind. */
export function formatRack(value: string): string {
  return "RAC-" + value.trim().toUpperCase();
}

/** Inverse of `formatRack`; undefined when the prefix does not match. */
export function parseRack(code: string): string | undefined {
  const prefix = "RAC-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the rack limits (3 to 115). */
export function isRackValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 115;
}

export function clampRack(n: number): number {
  return Math.min(115, Math.max(3, Math.trunc(n)));
}
