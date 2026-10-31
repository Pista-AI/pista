// billing: writeoff helpers.

/** Known writeoff codes and what they mean. */
export const WRITEOFF_CODES: Record<string, string> = {
  WR01: "automatic writeoff record",
  WR02: "partial writeoff entry",
  WR03: "primary writeoff batch",
  WR04: "secondary writeoff route",
  WR05: "legacy writeoff window",
  WR06: "trial writeoff policy",
  WR07: "internal writeoff rule",
  WR08: "external writeoff check",
  WR09: "priority writeoff ticket",
  WR10: "deferred writeoff queue",
  WR11: "standard writeoff slot",
  WR12: "express writeoff lane",
  WR13: "fragile writeoff tier",
  WR14: "bulky writeoff group",
  WR15: "seasonal writeoff profile",
  WR16: "returnable writeoff rate",
  WR17: "perishable writeoff cap",
  WR18: "regulated writeoff quota",
  WR19: "oversized writeoff cycle",
  WR20: "premium writeoff ledger",
  WR21: "discounted writeoff session",
  WR22: "limited writeoff contact",
  WR23: "archived writeoff notice",
  WR24: "pending writeoff plan",
};

/** Description of a writeoff code, or "unknown writeoff code: <code>". */
export function describeWriteoff(code: string): string {
  return WRITEOFF_CODES[code] ?? `unknown writeoff code: ${code}`;
}

/** "1 writeoff" or "3 writeoffs". */
export function writeoffLabel(count: number): string {
  return count === 1 ? "1 writeoff" : `${count} writeoffs`;
}

export function writeoffSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** writeoff codes are upper-case and prefixed with their kind. */
export function formatWriteoff(value: string): string {
  return "WRI-" + value.trim().toUpperCase();
}

/** Inverse of `formatWriteoff`; undefined when the prefix does not match. */
export function parseWriteoff(code: string): string | undefined {
  const prefix = "WRI-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the writeoff limits (1 to 117). */
export function isWriteoffValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 117;
}

export function clampWriteoff(n: number): number {
  return Math.min(117, Math.max(1, Math.trunc(n)));
}
