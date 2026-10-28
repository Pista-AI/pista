import { COUNTRY_ALIASES } from "./aliases.ts";

/** Turns whatever a customer record holds ("se", " Sverige ", "DE") into an upper-case alpha-2 code. */
export function normalizeCountry(raw: string): string {
  const trimmed = raw.trim();
  if (/^[a-z]{2}$/i.test(trimmed)) return trimmed.toUpperCase();
  const code = COUNTRY_ALIASES[trimmed.toLowerCase()];
  if (!code) throw new Error(`Unknown country: ${raw}`);
  return code;
}
