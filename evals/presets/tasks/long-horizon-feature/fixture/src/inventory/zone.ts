// inventory: zone helpers.

/** Known zone codes and what they mean. */
export const ZONE_CODES: Record<string, string> = {
  ZO01: "returnable zone profile",
  ZO02: "perishable zone rate",
  ZO03: "regulated zone cap",
  ZO04: "oversized zone quota",
  ZO05: "premium zone cycle",
  ZO06: "discounted zone ledger",
  ZO07: "limited zone session",
  ZO08: "archived zone contact",
  ZO09: "pending zone notice",
  ZO10: "verified zone plan",
  ZO11: "flagged zone request",
  ZO12: "manual zone record",
  ZO13: "automatic zone entry",
  ZO14: "partial zone batch",
  ZO15: "primary zone route",
  ZO16: "secondary zone window",
  ZO17: "legacy zone policy",
  ZO18: "trial zone rule",
  ZO19: "internal zone check",
  ZO20: "external zone ticket",
  ZO21: "priority zone queue",
  ZO22: "deferred zone slot",
  ZO23: "standard zone lane",
  ZO24: "express zone tier",
};

/** Description of a zone code, or "unknown zone code: <code>". */
export function describeZone(code: string): string {
  return ZONE_CODES[code] ?? `unknown zone code: ${code}`;
}

/** "1 zone" or "3 zones". */
export function zoneLabel(count: number): string {
  return count === 1 ? "1 zone" : `${count} zones`;
}

export function zoneSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** zone codes are upper-case and prefixed with their kind. */
export function formatZone(value: string): string {
  return "ZON-" + value.trim().toUpperCase();
}

/** Inverse of `formatZone`; undefined when the prefix does not match. */
export function parseZone(code: string): string | undefined {
  const prefix = "ZON-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the zone limits (1 to 105). */
export function isZoneValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 105;
}

export function clampZone(n: number): number {
  return Math.min(105, Math.max(1, Math.trunc(n)));
}
