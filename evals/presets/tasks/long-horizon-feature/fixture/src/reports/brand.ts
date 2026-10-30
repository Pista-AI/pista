// reports: brand helpers.

/** Known brand codes and what they mean. */
export const BRAND_CODES: Record<string, string> = {
  BR01: "trial brand rate",
  BR02: "internal brand cap",
  BR03: "external brand quota",
  BR04: "priority brand cycle",
  BR05: "deferred brand ledger",
  BR06: "standard brand session",
  BR07: "express brand contact",
  BR08: "fragile brand notice",
  BR09: "bulky brand plan",
  BR10: "seasonal brand request",
  BR11: "returnable brand record",
  BR12: "perishable brand entry",
  BR13: "regulated brand batch",
  BR14: "oversized brand route",
  BR15: "premium brand window",
  BR16: "discounted brand policy",
  BR17: "limited brand rule",
  BR18: "archived brand check",
  BR19: "pending brand ticket",
  BR20: "verified brand queue",
  BR21: "flagged brand slot",
  BR22: "manual brand lane",
  BR23: "automatic brand tier",
  BR24: "partial brand group",
};

/** Description of a brand code, or "unknown brand code: <code>". */
export function describeBrand(code: string): string {
  return BRAND_CODES[code] ?? `unknown brand code: ${code}`;
}

/** "1 brand" or "3 brands". */
export function brandLabel(count: number): string {
  return count === 1 ? "1 brand" : `${count} brands`;
}

export function brandSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** brand codes are upper-case and prefixed with their kind. */
export function formatBrand(value: string): string {
  return "BRA-" + value.trim().toUpperCase();
}

/** Inverse of `formatBrand`; undefined when the prefix does not match. */
export function parseBrand(code: string): string | undefined {
  const prefix = "BRA-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the brand limits (2 to 122). */
export function isBrandValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 122;
}

export function clampBrand(n: number): number {
  return Math.min(122, Math.max(2, Math.trunc(n)));
}
