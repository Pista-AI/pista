// notifications: sound helpers.

/** Known sound codes and what they mean. */
export const SOUND_CODES: Record<string, string> = {
  SO01: "regulated sound entry",
  SO02: "oversized sound batch",
  SO03: "premium sound route",
  SO04: "discounted sound window",
  SO05: "limited sound policy",
  SO06: "archived sound rule",
  SO07: "pending sound check",
  SO08: "verified sound ticket",
  SO09: "flagged sound queue",
  SO10: "manual sound slot",
  SO11: "automatic sound lane",
  SO12: "partial sound tier",
  SO13: "primary sound group",
  SO14: "secondary sound profile",
  SO15: "legacy sound rate",
  SO16: "trial sound cap",
  SO17: "internal sound quota",
  SO18: "external sound cycle",
  SO19: "priority sound ledger",
  SO20: "deferred sound session",
  SO21: "standard sound contact",
  SO22: "express sound notice",
  SO23: "fragile sound plan",
  SO24: "bulky sound request",
};

/** Description of a sound code, or "unknown sound code: <code>". */
export function describeSound(code: string): string {
  return SOUND_CODES[code] ?? `unknown sound code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 35, b: 36, c: 37 };

/** Relative weight of a sound class; unknown classes weigh nothing. */
export function soundWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalSoundWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + soundWeight(key), 0);
}

/** Scales a sound amount by the module factor and rounds to a whole number. */
export function soundScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function soundShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 sound" or "3 sounds". */
export function soundLabel(count: number): string {
  return count === 1 ? "1 sound" : `${count} sounds`;
}

export function soundSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
