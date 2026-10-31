// inventory: transfer helpers.

/** Known transfer codes and what they mean. */
export const TRANSFER_CODES: Record<string, string> = {
  TR01: "seasonal transfer quota",
  TR02: "returnable transfer cycle",
  TR03: "perishable transfer ledger",
  TR04: "regulated transfer session",
  TR05: "oversized transfer contact",
  TR06: "premium transfer notice",
  TR07: "discounted transfer plan",
  TR08: "limited transfer request",
  TR09: "archived transfer record",
  TR10: "pending transfer entry",
  TR11: "verified transfer batch",
  TR12: "flagged transfer route",
  TR13: "manual transfer window",
  TR14: "automatic transfer policy",
  TR15: "partial transfer rule",
  TR16: "primary transfer check",
  TR17: "secondary transfer ticket",
  TR18: "legacy transfer queue",
  TR19: "trial transfer slot",
  TR20: "internal transfer lane",
  TR21: "external transfer tier",
  TR22: "priority transfer group",
  TR23: "deferred transfer profile",
  TR24: "standard transfer rate",
};

/** Description of a transfer code, or "unknown transfer code: <code>". */
export function describeTransfer(code: string): string {
  return TRANSFER_CODES[code] ?? `unknown transfer code: ${code}`;
}

/** transfer codes are upper-case and prefixed with their kind. */
export function formatTransfer(value: string): string {
  return "TRA-" + value.trim().toUpperCase();
}

/** Inverse of `formatTransfer`; undefined when the prefix does not match. */
export function parseTransfer(code: string): string | undefined {
  const prefix = "TRA-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the transfer limits (3 to 131). */
export function isTransferValid(n: number): boolean {
  return Number.isInteger(n) && n >= 3 && n <= 131;
}

export function clampTransfer(n: number): number {
  return Math.min(131, Math.max(3, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 32, b: 33, c: 34 };

/** Relative weight of a transfer class; unknown classes weigh nothing. */
export function transferWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalTransferWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + transferWeight(key), 0);
}
