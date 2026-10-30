// reports: funnel helpers.

/** Known funnel codes and what they mean. */
export const FUNNEL_CODES: Record<string, string> = {
  FU01: "perishable funnel quota",
  FU02: "regulated funnel cycle",
  FU03: "oversized funnel ledger",
  FU04: "premium funnel session",
  FU05: "discounted funnel contact",
  FU06: "limited funnel notice",
  FU07: "archived funnel plan",
  FU08: "pending funnel request",
  FU09: "verified funnel record",
  FU10: "flagged funnel entry",
  FU11: "manual funnel batch",
  FU12: "automatic funnel route",
  FU13: "partial funnel window",
  FU14: "primary funnel policy",
  FU15: "secondary funnel rule",
  FU16: "legacy funnel check",
  FU17: "trial funnel ticket",
  FU18: "internal funnel queue",
  FU19: "external funnel slot",
  FU20: "priority funnel lane",
  FU21: "deferred funnel tier",
  FU22: "standard funnel group",
  FU23: "express funnel profile",
  FU24: "fragile funnel rate",
};

/** Description of a funnel code, or "unknown funnel code: <code>". */
export function describeFunnel(code: string): string {
  return FUNNEL_CODES[code] ?? `unknown funnel code: ${code}`;
}

/** Scales a funnel amount by the module factor and rounds to a whole number. */
export function funnelScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function funnelShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 funnel" or "3 funnels". */
export function funnelLabel(count: number): string {
  return count === 1 ? "1 funnel" : `${count} funnels`;
}

export function funnelSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** funnel codes are upper-case and prefixed with their kind. */
export function formatFunnel(value: string): string {
  return "FUN-" + value.trim().toUpperCase();
}

/** Inverse of `formatFunnel`; undefined when the prefix does not match. */
export function parseFunnel(code: string): string | undefined {
  const prefix = "FUN-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
