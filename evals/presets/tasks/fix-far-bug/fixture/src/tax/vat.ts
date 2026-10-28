import { normalizeCountry } from "../geo/country.ts";
import { percentOf } from "../money.ts";
import { DEFAULT_VAT, VAT_RATES } from "./rates.ts";

export function vatRateFor(country: string): number {
  return VAT_RATES[normalizeCountry(country)] ?? DEFAULT_VAT;
}

export function vatCents(netCents: number, country: string): number {
  return percentOf(netCents, vatRateFor(country));
}
