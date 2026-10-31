// reports: rollup helpers.

/** Known rollup codes and what they mean. */
export const ROLLUP_CODES: Record<string, string> = {
  RO01: "returnable rollup session",
  RO02: "perishable rollup contact",
  RO03: "regulated rollup notice",
  RO04: "oversized rollup plan",
  RO05: "premium rollup request",
  RO06: "discounted rollup record",
  RO07: "limited rollup entry",
  RO08: "archived rollup batch",
  RO09: "pending rollup route",
  RO10: "verified rollup window",
  RO11: "flagged rollup policy",
  RO12: "manual rollup rule",
  RO13: "automatic rollup check",
  RO14: "partial rollup ticket",
  RO15: "primary rollup queue",
  RO16: "secondary rollup slot",
  RO17: "legacy rollup lane",
  RO18: "trial rollup tier",
  RO19: "internal rollup group",
  RO20: "external rollup profile",
  RO21: "priority rollup rate",
  RO22: "deferred rollup cap",
  RO23: "standard rollup quota",
  RO24: "express rollup cycle",
};

/** Description of a rollup code, or "unknown rollup code: <code>". */
export function describeRollup(code: string): string {
  return ROLLUP_CODES[code] ?? `unknown rollup code: ${code}`;
}

/** "1 rollup" or "3 rollups". */
export function rollupLabel(count: number): string {
  return count === 1 ? "1 rollup" : `${count} rollups`;
}

export function rollupSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** rollup codes are upper-case and prefixed with their kind. */
export function formatRollup(value: string): string {
  return "ROL-" + value.trim().toUpperCase();
}

/** Inverse of `formatRollup`; undefined when the prefix does not match. */
export function parseRollup(code: string): string | undefined {
  const prefix = "ROL-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the rollup limits (0 to 132). */
export function isRollupValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 132;
}

export function clampRollup(n: number): number {
  return Math.min(132, Math.max(0, Math.trunc(n)));
}
