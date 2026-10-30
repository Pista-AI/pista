// billing: vault helpers.

/** Known vault codes and what they mean. */
export const VAULT_CODES: Record<string, string> = {
  VA01: "express vault ticket",
  VA02: "fragile vault queue",
  VA03: "bulky vault slot",
  VA04: "seasonal vault lane",
  VA05: "returnable vault tier",
  VA06: "perishable vault group",
  VA07: "regulated vault profile",
  VA08: "oversized vault rate",
  VA09: "premium vault cap",
  VA10: "discounted vault quota",
  VA11: "limited vault cycle",
  VA12: "archived vault ledger",
  VA13: "pending vault session",
  VA14: "verified vault contact",
  VA15: "flagged vault notice",
  VA16: "manual vault plan",
  VA17: "automatic vault request",
  VA18: "partial vault record",
  VA19: "primary vault entry",
  VA20: "secondary vault batch",
  VA21: "legacy vault route",
  VA22: "trial vault window",
  VA23: "internal vault policy",
  VA24: "external vault rule",
};

/** Description of a vault code, or "unknown vault code: <code>". */
export function describeVault(code: string): string {
  return VAULT_CODES[code] ?? `unknown vault code: ${code}`;
}

/** vault codes are upper-case and prefixed with their kind. */
export function formatVault(value: string): string {
  return "VAU-" + value.trim().toUpperCase();
}

/** Inverse of `formatVault`; undefined when the prefix does not match. */
export function parseVault(code: string): string | undefined {
  const prefix = "VAU-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the vault limits (0 to 128). */
export function isVaultValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 128;
}

export function clampVault(n: number): number {
  return Math.min(128, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 29, b: 30, c: 31 };

/** Relative weight of a vault class; unknown classes weigh nothing. */
export function vaultWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalVaultWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + vaultWeight(key), 0);
}
