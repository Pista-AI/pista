// notifications: locale helpers.

/** Known locale codes and what they mean. */
export const LOCALE_CODES: Record<string, string> = {
  LO01: "automatic locale record",
  LO02: "partial locale entry",
  LO03: "primary locale batch",
  LO04: "secondary locale route",
  LO05: "legacy locale window",
  LO06: "trial locale policy",
  LO07: "internal locale rule",
  LO08: "external locale check",
  LO09: "priority locale ticket",
  LO10: "deferred locale queue",
  LO11: "standard locale slot",
  LO12: "express locale lane",
  LO13: "fragile locale tier",
  LO14: "bulky locale group",
  LO15: "seasonal locale profile",
  LO16: "returnable locale rate",
  LO17: "perishable locale cap",
  LO18: "regulated locale quota",
  LO19: "oversized locale cycle",
  LO20: "premium locale ledger",
  LO21: "discounted locale session",
  LO22: "limited locale contact",
  LO23: "archived locale notice",
  LO24: "pending locale plan",
};

/** Description of a locale code, or "unknown locale code: <code>". */
export function describeLocale(code: string): string {
  return LOCALE_CODES[code] ?? `unknown locale code: ${code}`;
}

/** locale codes are upper-case and prefixed with their kind. */
export function formatLocale(value: string): string {
  return "LOC-" + value.trim().toUpperCase();
}

/** Inverse of `formatLocale`; undefined when the prefix does not match. */
export function parseLocale(code: string): string | undefined {
  const prefix = "LOC-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the locale limits (1 to 117). */
export function isLocaleValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 117;
}

export function clampLocale(n: number): number {
  return Math.min(117, Math.max(1, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 18, b: 19, c: 20 };

/** Relative weight of a locale class; unknown classes weigh nothing. */
export function localeWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalLocaleWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + localeWeight(key), 0);
}
