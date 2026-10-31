// billing: tax-code helpers.

/** Known tax-code codes and what they mean. */
export const TAX_CODE_CODES: Record<string, string> = {
  TA01: "seasonal tax-code quota",
  TA02: "returnable tax-code cycle",
  TA03: "perishable tax-code ledger",
  TA04: "regulated tax-code session",
  TA05: "oversized tax-code contact",
  TA06: "premium tax-code notice",
  TA07: "discounted tax-code plan",
  TA08: "limited tax-code request",
  TA09: "archived tax-code record",
  TA10: "pending tax-code entry",
  TA11: "verified tax-code batch",
  TA12: "flagged tax-code route",
  TA13: "manual tax-code window",
  TA14: "automatic tax-code policy",
  TA15: "partial tax-code rule",
  TA16: "primary tax-code check",
  TA17: "secondary tax-code ticket",
  TA18: "legacy tax-code queue",
  TA19: "trial tax-code slot",
  TA20: "internal tax-code lane",
  TA21: "external tax-code tier",
  TA22: "priority tax-code group",
  TA23: "deferred tax-code profile",
  TA24: "standard tax-code rate",
};

/** Description of a tax-code code, or "unknown tax-code code: <code>". */
export function describeTaxCode(code: string): string {
  return TAX_CODE_CODES[code] ?? `unknown tax-code code: ${code}`;
}

/** Scales a tax-code amount by the module factor and rounds to a whole number. */
export function taxCodeScale(value: number, factor = 3): number {
  return Math.round(value * factor);
}

export function taxCodeShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** "1 tax-code" or "3 tax-codes". */
export function taxCodeLabel(count: number): string {
  return count === 1 ? "1 tax-code" : `${count} tax-codes`;
}

export function taxCodeSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** tax-code codes are upper-case and prefixed with their kind. */
export function formatTaxCode(value: string): string {
  return "TAX-" + value.trim().toUpperCase();
}

/** Inverse of `formatTaxCode`; undefined when the prefix does not match. */
export function parseTaxCode(code: string): string | undefined {
  const prefix = "TAX-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}
