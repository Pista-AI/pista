// reports: forecast helpers.

/** Known forecast codes and what they mean. */
export const FORECAST_CODES: Record<string, string> = {
  FO01: "automatic forecast record",
  FO02: "partial forecast entry",
  FO03: "primary forecast batch",
  FO04: "secondary forecast route",
  FO05: "legacy forecast window",
  FO06: "trial forecast policy",
  FO07: "internal forecast rule",
  FO08: "external forecast check",
  FO09: "priority forecast ticket",
  FO10: "deferred forecast queue",
  FO11: "standard forecast slot",
  FO12: "express forecast lane",
  FO13: "fragile forecast tier",
  FO14: "bulky forecast group",
  FO15: "seasonal forecast profile",
  FO16: "returnable forecast rate",
  FO17: "perishable forecast cap",
  FO18: "regulated forecast quota",
  FO19: "oversized forecast cycle",
  FO20: "premium forecast ledger",
  FO21: "discounted forecast session",
  FO22: "limited forecast contact",
  FO23: "archived forecast notice",
  FO24: "pending forecast plan",
};

/** Description of a forecast code, or "unknown forecast code: <code>". */
export function describeForecast(code: string): string {
  return FORECAST_CODES[code] ?? `unknown forecast code: ${code}`;
}

/** "1 forecast" or "3 forecasts". */
export function forecastLabel(count: number): string {
  return count === 1 ? "1 forecast" : `${count} forecasts`;
}

export function forecastSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}: ${c}`);
  return parts.length ? parts.join(", ") : "none";
}

/** forecast codes are upper-case and prefixed with their kind. */
export function formatForecast(value: string): string {
  return "FOR-" + value.trim().toUpperCase();
}

/** Inverse of `formatForecast`; undefined when the prefix does not match. */
export function parseForecast(code: string): string | undefined {
  const prefix = "FOR-";
  return code.startsWith(prefix) ? code.slice(prefix.length) : undefined;
}

/** Whether `n` is a whole number inside the forecast limits (1 to 117). */
export function isForecastValid(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 117;
}

export function clampForecast(n: number): number {
  return Math.min(117, Math.max(1, Math.trunc(n)));
}
