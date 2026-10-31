// orders: channel helpers.

/** Known channel codes and what they mean. */
export const CHANNEL_CODES: Record<string, string> = {
  CH01: "express channel ticket",
  CH02: "fragile channel queue",
  CH03: "bulky channel slot",
  CH04: "seasonal channel lane",
  CH05: "returnable channel tier",
  CH06: "perishable channel group",
  CH07: "regulated channel profile",
  CH08: "oversized channel rate",
  CH09: "premium channel cap",
  CH10: "discounted channel quota",
  CH11: "limited channel cycle",
  CH12: "archived channel ledger",
  CH13: "pending channel session",
  CH14: "verified channel contact",
  CH15: "flagged channel notice",
  CH16: "manual channel plan",
  CH17: "automatic channel request",
  CH18: "partial channel record",
  CH19: "primary channel entry",
  CH20: "secondary channel batch",
  CH21: "legacy channel route",
  CH22: "trial channel window",
  CH23: "internal channel policy",
  CH24: "external channel rule",
};

/** Description of a channel code, or "unknown channel code: <code>". */
export function describeChannel(code: string): string {
  return CHANNEL_CODES[code] ?? `unknown channel code: ${code}`;
}

/** "1 channel" or "3 channels". */
export function channelLabel(count: number): string {
  return count === 1 ? "1 channel" : `${count} channels`;
}

export function channelSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** channel codes are upper-case and prefixed with their kind. */
export function formatChannel(value: string): string {
  return "CHA-" + value.trim().toUpperCase();
}

/** Inverse of `formatChannel`; undefined when the prefix does not match. */
export function parseChannel(code: string): string | undefined {
  const prefix = "CHA-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the channel limits (0 to 128). */
export function isChannelValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 128;
}

export function clampChannel(n: number): number {
  return Math.min(128, Math.max(0, Math.trunc(n)));
}
