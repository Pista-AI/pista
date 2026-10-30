// reports: trend helpers.

/** Known trend codes and what they mean. */
export const TREND_CODES: Record<string, string> = {
  TR01: "manual trend notice",
  TR02: "automatic trend plan",
  TR03: "partial trend request",
  TR04: "primary trend record",
  TR05: "secondary trend entry",
  TR06: "legacy trend batch",
  TR07: "trial trend route",
  TR08: "internal trend window",
  TR09: "external trend policy",
  TR10: "priority trend rule",
  TR11: "deferred trend check",
  TR12: "standard trend ticket",
  TR13: "express trend queue",
  TR14: "fragile trend slot",
  TR15: "bulky trend lane",
  TR16: "seasonal trend tier",
  TR17: "returnable trend group",
  TR18: "perishable trend profile",
  TR19: "regulated trend rate",
  TR20: "oversized trend cap",
  TR21: "premium trend quota",
  TR22: "discounted trend cycle",
  TR23: "limited trend ledger",
  TR24: "archived trend session",
};

/** Description of a trend code, or "unknown trend code: <code>". */
export function describeTrend(code: string): string {
  return TREND_CODES[code] ?? `unknown trend code: ${code}`;
}

/** Scales a trend amount by the module factor and rounds to a whole number. */
export function trendScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function trendShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 trend" or "3 trends". */
export function trendLabel(count: number): string {
  return count === 1 ? "1 trend" : `${count} trends`;
}

export function trendSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** trend codes are upper-case and prefixed with their kind. */
export function formatTrend(value: string): string {
  return "TRE-" + value.trim().toUpperCase();
}

/** Inverse of `formatTrend`; undefined when the prefix does not match. */
export function parseTrend(code: string): string | undefined {
  const prefix = "TRE-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
