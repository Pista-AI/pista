// notifications: channel helpers.

/** Known channel codes and what they mean. */
export const CHANNEL_CODES: Record<string, string> = {
  CH01: "oversized channel plan",
  CH02: "premium channel request",
  CH03: "discounted channel record",
  CH04: "limited channel entry",
  CH05: "archived channel batch",
  CH06: "pending channel route",
  CH07: "verified channel window",
  CH08: "flagged channel policy",
  CH09: "manual channel rule",
  CH10: "automatic channel check",
  CH11: "partial channel ticket",
  CH12: "primary channel queue",
  CH13: "secondary channel slot",
  CH14: "legacy channel lane",
  CH15: "trial channel tier",
  CH16: "internal channel group",
  CH17: "external channel profile",
  CH18: "priority channel rate",
  CH19: "deferred channel cap",
  CH20: "standard channel quota",
  CH21: "express channel cycle",
  CH22: "fragile channel ledger",
  CH23: "bulky channel session",
  CH24: "seasonal channel contact",
};

/** Description of a channel code, or "unknown channel code: <code>". */
export function describeChannel(code: string): string {
  return CHANNEL_CODES[code] ?? `unknown channel code: ${code}`;
}

/** Whether `n` is a whole number inside the channel limits (0 to 108). */
export function isChannelValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 108;
}

export function clampChannel(n: number): number {
  return Math.min(108, Math.max(0, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 9, b: 10, c: 11 };

/** Relative weight of a channel class; unknown classes weigh nothing. */
export function channelWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalChannelWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + channelWeight(key), 0);
}

/** Scales a channel amount by the module factor and rounds to a whole number. */
export function channelScale(value: number, factor = 5): number {
  return Math.round(value * factor);
}

export function channelShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
