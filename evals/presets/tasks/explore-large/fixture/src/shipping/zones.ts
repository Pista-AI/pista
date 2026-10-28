import type { Zone } from "./rates.ts";

export function zoneFor(country: string): Zone {
  if (country === "SE") return "domestic";
  return country === "NO" || country === "DK" || country === "FI" ? "nordic" : "europe";
}
