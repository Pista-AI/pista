// notifications: digest helpers.

/** Known digest codes and what they mean. */
export const DIGEST_CODES: Record<string, string> = {
  DI01: "bulky digest ticket",
  DI02: "seasonal digest queue",
  DI03: "returnable digest slot",
  DI04: "perishable digest lane",
  DI05: "regulated digest tier",
  DI06: "oversized digest group",
  DI07: "premium digest profile",
  DI08: "discounted digest rate",
  DI09: "limited digest cap",
  DI10: "archived digest quota",
  DI11: "pending digest cycle",
  DI12: "verified digest ledger",
  DI13: "flagged digest session",
  DI14: "manual digest contact",
  DI15: "automatic digest notice",
  DI16: "partial digest plan",
  DI17: "primary digest request",
  DI18: "secondary digest record",
  DI19: "legacy digest entry",
  DI20: "trial digest batch",
  DI21: "internal digest route",
  DI22: "external digest window",
  DI23: "priority digest policy",
  DI24: "deferred digest rule",
};

/** Description of a digest code, or "unknown digest code: <code>". */
export function describeDigest(code: string): string {
  return DIGEST_CODES[code] ?? `unknown digest code: ${code}`;
}

/** Whether `n` is a whole number inside the digest limits (3 to 103). */
export function isDigestValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 103;
}

export function clampDigest(n: number): number {
  return Math.min(103, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 4, b: 5, c: 6 };

/** Relative weight of a digest class; unknown classes weigh nothing. */
export function digestWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalDigestWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + digestWeight(key), 0);
}

/** Scales a digest amount by the module factor and rounds to a whole number. */
export function digestScale(value: number, factor = 5): number {
  return Math.round(value * factor);
}

export function digestShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
