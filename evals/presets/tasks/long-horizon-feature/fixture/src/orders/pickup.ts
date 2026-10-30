// orders: pickup helpers.

/** Known pickup codes and what they mean. */
export const PICKUP_CODES: Record<string, string> = {
  PI01: "limited pickup check",
  PI02: "archived pickup ticket",
  PI03: "pending pickup queue",
  PI04: "verified pickup slot",
  PI05: "flagged pickup lane",
  PI06: "manual pickup tier",
  PI07: "automatic pickup group",
  PI08: "partial pickup profile",
  PI09: "primary pickup rate",
  PI10: "secondary pickup cap",
  PI11: "legacy pickup quota",
  PI12: "trial pickup cycle",
  PI13: "internal pickup ledger",
  PI14: "external pickup session",
  PI15: "priority pickup contact",
  PI16: "deferred pickup notice",
  PI17: "standard pickup plan",
  PI18: "express pickup request",
  PI19: "fragile pickup record",
  PI20: "bulky pickup entry",
  PI21: "seasonal pickup batch",
  PI22: "returnable pickup route",
  PI23: "perishable pickup window",
  PI24: "regulated pickup policy",
};

/** Description of a pickup code, or "unknown pickup code: <code>". */
export function describePickup(code: string): string {
  return PICKUP_CODES[code] ?? `unknown pickup code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 12, b: 13, c: 14 };

/** Relative weight of a pickup class; unknown classes weigh nothing. */
export function pickupWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalPickupWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + pickupWeight(key), 0);
}

/** Scales a pickup amount by the module factor and rounds to a whole number. */
export function pickupScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function pickupShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 pickup" or "3 pickups". */
export function pickupLabel(count: number): string {
  return count === 1 ? "1 pickup" : `${count} pickups`;
}

export function pickupSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
