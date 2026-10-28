import { normalizeCountry } from "./country.ts";

export type Region = "nordic" | "eu" | "world";

const NORDIC = new Set(["SE", "NO", "DK", "FI", "IS"]);
const EU = new Set(["SE", "DK", "FI", "DE", "FR", "NL", "ES", "IT"]);

export function regionOf(country: string): Region {
  const code = normalizeCountry(country);
  if (NORDIC.has(code)) return "nordic";
  if (EU.has(code)) return "eu";
  return "world";
}
