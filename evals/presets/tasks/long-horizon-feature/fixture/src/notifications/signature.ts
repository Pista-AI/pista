// notifications: signature helpers.

/** Known signature codes and what they mean. */
export const SIGNATURE_CODES: Record<string, string> = {
  SI01: "legacy signature tier",
  SI02: "trial signature group",
  SI03: "internal signature profile",
  SI04: "external signature rate",
  SI05: "priority signature cap",
  SI06: "deferred signature quota",
  SI07: "standard signature cycle",
  SI08: "express signature ledger",
  SI09: "fragile signature session",
  SI10: "bulky signature contact",
  SI11: "seasonal signature notice",
  SI12: "returnable signature plan",
  SI13: "perishable signature request",
  SI14: "regulated signature record",
  SI15: "oversized signature entry",
  SI16: "premium signature batch",
  SI17: "discounted signature route",
  SI18: "limited signature window",
  SI19: "archived signature policy",
  SI20: "pending signature rule",
  SI21: "verified signature check",
  SI22: "flagged signature ticket",
  SI23: "manual signature queue",
  SI24: "automatic signature slot",
};

/** Description of a signature code, or "unknown signature code: <code>". */
export function describeSignature(code: string): string {
  return SIGNATURE_CODES[code] ?? `unknown signature code: ${code}`;
}

/** "1 signature" or "3 signatures". */
export function signatureLabel(count: number): string {
  return count === 1 ? "1 signature" : `${count} signatures`;
}

export function signatureSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** signature codes are upper-case and prefixed with their kind. */
export function formatSignature(value: string): string {
  return "SIG-" + value.trim().toUpperCase();
}

/** Inverse of `formatSignature`; undefined when the prefix does not match. */
export function parseSignature(code: string): string | undefined {
  const prefix = "SIG-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the signature limits (1 to 121). */
export function isSignatureValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 121;
}

export function clampSignature(n: number): number {
  return Math.min(121, Math.max(1, Math.trunc(n)));
}
