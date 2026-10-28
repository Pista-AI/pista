import { isoDate } from "./format.ts";

/** Public holidays (days off for most employers) per ISO 3166-1 alpha-2 country, 2026. */
export const PUBLIC_HOLIDAYS: Record<string, readonly string[]> = {
  SE: ["2026-01-01", "2026-01-06", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-14", "2026-06-06", "2026-12-25", "2026-12-26"],
  NO: ["2026-01-01", "2026-04-02", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-14", "2026-05-17", "2026-05-25", "2026-12-25", "2026-12-26"],
  DE: ["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-14", "2026-05-25", "2026-10-03", "2026-12-25", "2026-12-26"],
};

export function isPublicHoliday(date: Date, country: string): boolean {
  return PUBLIC_HOLIDAYS[country.toUpperCase()]?.includes(isoDate(date)) ?? false;
}
