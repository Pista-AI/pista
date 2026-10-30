// notifications: queue helpers.

/** Known queue codes and what they mean. */
export const QUEUE_CODES: Record<string, string> = {
  QU01: "express queue ticket",
  QU02: "fragile queue queue",
  QU03: "bulky queue slot",
  QU04: "seasonal queue lane",
  QU05: "returnable queue tier",
  QU06: "perishable queue group",
  QU07: "regulated queue profile",
  QU08: "oversized queue rate",
  QU09: "premium queue cap",
  QU10: "discounted queue quota",
  QU11: "limited queue cycle",
  QU12: "archived queue ledger",
  QU13: "pending queue session",
  QU14: "verified queue contact",
  QU15: "flagged queue notice",
  QU16: "manual queue plan",
  QU17: "automatic queue request",
  QU18: "partial queue record",
  QU19: "primary queue entry",
  QU20: "secondary queue batch",
  QU21: "legacy queue route",
  QU22: "trial queue window",
  QU23: "internal queue policy",
  QU24: "external queue rule",
};

/** Description of a queue code, or "unknown queue code: <code>". */
export function describeQueue(code: string): string {
  return QUEUE_CODES[code] ?? `unknown queue code: ${code}`;
}

/** Whether `n` is a whole number inside the queue limits (0 to 128). */
export function isQueueValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 128;
}

export function clampQueue(n: number): number {
  return Math.min(128, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 29, b: 30, c: 31 };

/** Relative weight of a queue class; unknown classes weigh nothing. */
export function queueWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalQueueWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + queueWeight(key), 0);
}

/** Scales a queue amount by the module factor and rounds to a whole number. */
export function queueScale(value: number, factor = 5): number {
  return Math.round(value * factor);
}

export function queueShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
