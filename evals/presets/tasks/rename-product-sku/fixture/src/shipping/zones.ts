export type Zone = "domestic" | "nordic" | "eu";

export function zoneFor(country: string): Zone {
  if (country === "SE") return "domestic";
  if (["NO", "DK", "FI"].includes(country)) return "nordic";
  return "eu";
}
