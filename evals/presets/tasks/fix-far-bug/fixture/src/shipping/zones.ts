import { normalizeCountry } from "../geo/country.ts";
import { regionOf } from "../geo/regions.ts";
import type { Zone } from "./rates.ts";

const HOME = "SE";

export function zoneFor(country: string): Zone {
  if (normalizeCountry(country) === HOME) return "domestic";
  const region = regionOf(country);
  return region === "nordic" ? "nordic" : region === "eu" ? "europe" : "world";
}
