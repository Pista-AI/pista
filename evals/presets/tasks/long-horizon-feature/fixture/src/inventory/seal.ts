// inventory: seal helpers.

/** Known seal codes and what they mean. */
export const SEAL_CODES: Record<string, string> = {
  SE01: "premium seal check",
  SE02: "discounted seal ticket",
  SE03: "limited seal queue",
  SE04: "archived seal slot",
  SE05: "pending seal lane",
  SE06: "verified seal tier",
  SE07: "flagged seal group",
  SE08: "manual seal profile",
  SE09: "automatic seal rate",
  SE10: "partial seal cap",
  SE11: "primary seal quota",
  SE12: "secondary seal cycle",
  SE13: "legacy seal ledger",
  SE14: "trial seal session",
  SE15: "internal seal contact",
  SE16: "external seal notice",
  SE17: "priority seal plan",
  SE18: "deferred seal request",
  SE19: "standard seal record",
  SE20: "express seal entry",
  SE21: "fragile seal batch",
  SE22: "bulky seal route",
  SE23: "seasonal seal window",
  SE24: "returnable seal policy",
};

/** Description of a seal code, or "unknown seal code: <code>". */
export function describeSeal(code: string): string {
  return SEAL_CODES[code] ?? `unknown seal code: ${code}`;
}

/** seal codes are upper-case and prefixed with their kind. */
export function formatSeal(value: string): string {
  return "SEA-" + value.trim().toUpperCase();
}

/** Inverse of `formatSeal`; undefined when the prefix does not match. */
export function parseSeal(code: string): string | undefined {
  const prefix = "SEA-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the seal limits (0 to 136). */
export function isSealValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 136;
}

export function clampSeal(n: number): number {
  return Math.min(136, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 37, b: 38, c: 39 };

/** Relative weight of a seal class; unknown classes weigh nothing. */
export function sealWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalSealWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + sealWeight(key), 0);
}
