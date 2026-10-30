// orders: address helpers.

/** Known address codes and what they mean. */
export const ADDRESS_CODES: Record<string, string> = {
  AD01: "perishable address quota",
  AD02: "regulated address cycle",
  AD03: "oversized address ledger",
  AD04: "premium address session",
  AD05: "discounted address contact",
  AD06: "limited address notice",
  AD07: "archived address plan",
  AD08: "pending address request",
  AD09: "verified address record",
  AD10: "flagged address entry",
  AD11: "manual address batch",
  AD12: "automatic address route",
  AD13: "partial address window",
  AD14: "primary address policy",
  AD15: "secondary address rule",
  AD16: "legacy address check",
  AD17: "trial address ticket",
  AD18: "internal address queue",
  AD19: "external address slot",
  AD20: "priority address lane",
  AD21: "deferred address tier",
  AD22: "standard address group",
  AD23: "express address profile",
  AD24: "fragile address rate",
};

/** Description of a address code, or "unknown address code: <code>". */
export function describeAddress(code: string): string {
  return ADDRESS_CODES[code] ?? `unknown address code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 7, b: 8, c: 9 };

/** Relative weight of a address class; unknown classes weigh nothing. */
export function addressWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalAddressWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + addressWeight(key), 0);
}

/** Scales a address amount by the module factor and rounds to a whole number. */
export function addressScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function addressShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 address" or "3 addresss". */
export function addressLabel(count: number): string {
  return count === 1 ? "1 address" : `${count} addresss`;
}

export function addressSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
