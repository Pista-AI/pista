// reports: rank helpers.

/** Known rank codes and what they mean. */
export const RANK_CODES: Record<string, string> = {
  RA01: "discounted rank slot",
  RA02: "limited rank lane",
  RA03: "archived rank tier",
  RA04: "pending rank group",
  RA05: "verified rank profile",
  RA06: "flagged rank rate",
  RA07: "manual rank cap",
  RA08: "automatic rank quota",
  RA09: "partial rank cycle",
  RA10: "primary rank ledger",
  RA11: "secondary rank session",
  RA12: "legacy rank contact",
  RA13: "trial rank notice",
  RA14: "internal rank plan",
  RA15: "external rank request",
  RA16: "priority rank record",
  RA17: "deferred rank entry",
  RA18: "standard rank batch",
  RA19: "express rank route",
  RA20: "fragile rank window",
  RA21: "bulky rank policy",
  RA22: "seasonal rank rule",
  RA23: "returnable rank check",
  RA24: "perishable rank ticket",
};

/** Description of a rank code, or "unknown rank code: <code>". */
export function describeRank(code: string): string {
  return RANK_CODES[code] ?? `unknown rank code: ${code}`;
}

/** "1 rank" or "3 ranks". */
export function rankLabel(count: number): string {
  return count === 1 ? "1 rank" : `${count} ranks`;
}

export function rankSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** rank codes are upper-case and prefixed with their kind. */
export function formatRank(value: string): string {
  return "RAN-" + value.trim().toUpperCase();
}

/** Inverse of `formatRank`; undefined when the prefix does not match. */
export function parseRank(code: string): string | undefined {
  const prefix = "RAN-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the rank limits (1 to 137). */
export function isRankValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 137;
}

export function clampRank(n: number): number {
  return Math.min(137, Math.max(1, Math.trunc(n)));
}
