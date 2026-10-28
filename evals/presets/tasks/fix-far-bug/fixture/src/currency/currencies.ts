import { normalizeCountry } from "../geo/country.ts";

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  DE: "EUR",
  FI: "EUR",
};

/** Invoices are issued in the customer's local currency; unknown countries are billed in EUR. */
export function currencyFor(country: string): string {
  return CURRENCY_BY_COUNTRY[normalizeCountry(country)] ?? "EUR";
}
