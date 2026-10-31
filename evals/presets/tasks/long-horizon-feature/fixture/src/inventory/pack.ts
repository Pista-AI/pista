// inventory: pack helpers.

/** Known pack codes and what they mean. */
export const PACK_CODES: Record<string, string> = {
  PA01: "priority pack request",
  PA02: "deferred pack record",
  PA03: "standard pack entry",
  PA04: "express pack batch",
  PA05: "fragile pack route",
  PA06: "bulky pack window",
  PA07: "seasonal pack policy",
  PA08: "returnable pack rule",
  PA09: "perishable pack check",
  PA10: "regulated pack ticket",
  PA11: "oversized pack queue",
  PA12: "premium pack slot",
  PA13: "discounted pack lane",
  PA14: "limited pack tier",
  PA15: "archived pack group",
  PA16: "pending pack profile",
  PA17: "verified pack rate",
  PA18: "flagged pack cap",
  PA19: "manual pack quota",
  PA20: "automatic pack cycle",
  PA21: "partial pack ledger",
  PA22: "primary pack session",
  PA23: "secondary pack contact",
  PA24: "legacy pack notice",
};

/** Description of a pack code, or "unknown pack code: <code>". */
export function describePack(code: string): string {
  return PACK_CODES[code] ?? `unknown pack code: ${code}`;
}

/** "1 pack" or "3 packs". */
export function packLabel(count: number): string {
  return count === 1 ? "1 pack" : `${count} packs`;
}

export function packSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** pack codes are upper-case and prefixed with their kind. */
export function formatPack(value: string): string {
  return "PAC-" + value.trim().toUpperCase();
}

/** Inverse of `formatPack`; undefined when the prefix does not match. */
export function parsePack(code: string): string | undefined {
  const prefix = "PAC-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the pack limits (1 to 125). */
export function isPackValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 125;
}

export function clampPack(n: number): number {
  return Math.min(125, Math.max(1, Math.trunc(n)));
}
