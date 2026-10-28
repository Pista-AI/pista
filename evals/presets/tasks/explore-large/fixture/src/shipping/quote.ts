import { SHIPPING_CENTS } from "./rates.ts";
import { zoneFor } from "./zones.ts";

export function shippingCents(country: string): number {
  return SHIPPING_CENTS[zoneFor(country)];
}
