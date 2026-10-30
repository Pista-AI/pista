// notifications: topic helpers.

/** Known topic codes and what they mean. */
export const TOPIC_CODES: Record<string, string> = {
  TO01: "premium topic entry",
  TO02: "discounted topic batch",
  TO03: "limited topic route",
  TO04: "archived topic window",
  TO05: "pending topic policy",
  TO06: "verified topic rule",
  TO07: "flagged topic check",
  TO08: "manual topic ticket",
  TO09: "automatic topic queue",
  TO10: "partial topic slot",
  TO11: "primary topic lane",
  TO12: "secondary topic tier",
  TO13: "legacy topic group",
  TO14: "trial topic profile",
  TO15: "internal topic rate",
  TO16: "external topic cap",
  TO17: "priority topic quota",
  TO18: "deferred topic cycle",
  TO19: "standard topic ledger",
  TO20: "express topic session",
  TO21: "fragile topic contact",
  TO22: "bulky topic notice",
  TO23: "seasonal topic plan",
  TO24: "returnable topic request",
};

/** Description of a topic code, or "unknown topic code: <code>". */
export function describeTopic(code: string): string {
  return TOPIC_CODES[code] ?? `unknown topic code: ${code}`;
}

const WEIGHTS: Record<string, number> = { a: 10, b: 11, c: 12 };

/** Relative weight of a topic class; unknown classes weigh nothing. */
export function topicWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalTopicWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + topicWeight(key), 0);
}

/** Scales a topic amount by the module factor and rounds to a whole number. */
export function topicScale(value: number, factor = 6): number {
  return Math.round(value * factor);
}

export function topicShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 topic" or "3 topics". */
export function topicLabel(count: number): string {
  return count === 1 ? "1 topic" : `${count} topics`;
}

export function topicSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}
