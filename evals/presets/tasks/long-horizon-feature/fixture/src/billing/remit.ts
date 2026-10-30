// billing: remit helpers.

/** Known remit codes and what they mean. */
export const REMIT_CODES: Record<string, string> = {
  RE01: "returnable remit session",
  RE02: "perishable remit contact",
  RE03: "regulated remit notice",
  RE04: "oversized remit plan",
  RE05: "premium remit request",
  RE06: "discounted remit record",
  RE07: "limited remit entry",
  RE08: "archived remit batch",
  RE09: "pending remit route",
  RE10: "verified remit window",
  RE11: "flagged remit policy",
  RE12: "manual remit rule",
  RE13: "automatic remit check",
  RE14: "partial remit ticket",
  RE15: "primary remit queue",
  RE16: "secondary remit slot",
  RE17: "legacy remit lane",
  RE18: "trial remit tier",
  RE19: "internal remit group",
  RE20: "external remit profile",
  RE21: "priority remit rate",
  RE22: "deferred remit cap",
  RE23: "standard remit quota",
  RE24: "express remit cycle",
};

/** Description of a remit code, or "unknown remit code: <code>". */
export function describeRemit(code: string): string {
  return REMIT_CODES[code] ?? `unknown remit code: ${code}`;
}

/** "1 remit" or "3 remits". */
export function remitLabel(count: number): string {
  return count === 1 ? "1 remit" : `${count} remits`;
}

export function remitSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** remit codes are upper-case and prefixed with their kind. */
export function formatRemit(value: string): string {
  return "REM-" + value.trim().toUpperCase();
}

/** Inverse of `formatRemit`; undefined when the prefix does not match. */
export function parseRemit(code: string): string | undefined {
  const prefix = "REM-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the remit limits (0 to 132). */
export function isRemitValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 132;
}

export function clampRemit(n: number): number {
  return Math.min(132, Math.max(0, Math.trunc(n)));
}
