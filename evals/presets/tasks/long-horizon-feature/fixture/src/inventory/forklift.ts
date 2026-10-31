// inventory: forklift helpers.

/** Known forklift codes and what they mean. */
export const FORKLIFT_CODES: Record<string, string> = {
  FO01: "regulated forklift entry",
  FO02: "oversized forklift batch",
  FO03: "premium forklift route",
  FO04: "discounted forklift window",
  FO05: "limited forklift policy",
  FO06: "archived forklift rule",
  FO07: "pending forklift check",
  FO08: "verified forklift ticket",
  FO09: "flagged forklift queue",
  FO10: "manual forklift slot",
  FO11: "automatic forklift lane",
  FO12: "partial forklift tier",
  FO13: "primary forklift group",
  FO14: "secondary forklift profile",
  FO15: "legacy forklift rate",
  FO16: "trial forklift cap",
  FO17: "internal forklift quota",
  FO18: "external forklift cycle",
  FO19: "priority forklift ledger",
  FO20: "deferred forklift session",
  FO21: "standard forklift contact",
  FO22: "express forklift notice",
  FO23: "fragile forklift plan",
  FO24: "bulky forklift request",
};

/** Description of a forklift code, or "unknown forklift code: <code>". */
export function describeForklift(code: string): string {
  return FORKLIFT_CODES[code] ?? `unknown forklift code: ${code}`;
}

/** Scales a forklift amount by the module factor and rounds to a whole number. */
export function forkliftScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function forkliftShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 forklift" or "3 forklifts". */
export function forkliftLabel(count: number): string {
  return count === 1 ? "1 forklift" : `${count} forklifts`;
}

export function forkliftSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** forklift codes are upper-case and prefixed with their kind. */
export function formatForklift(value: string): string {
  return "FOR-" + value.trim().toUpperCase();
}

/** Inverse of `formatForklift`; undefined when the prefix does not match. */
export function parseForklift(code: string): string | undefined {
  const prefix = "FOR-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
