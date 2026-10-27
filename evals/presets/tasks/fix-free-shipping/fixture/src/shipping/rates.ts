import { sek } from "../money.ts";
import type { Zone } from "./zones.ts";

/** Base rate per zone, plus a surcharge for parcels over 5 kg. */
const BASE: Record<Zone, number> = { domestic: sek(49), nordic: sek(99), eu: sek(149) };
const HEAVY_OVER_GRAMS = 5000;
const HEAVY_SURCHARGE = sek(60);

export function rateCents(zone: Zone, weightGrams: number): number {
  return BASE[zone] + (weightGrams > HEAVY_OVER_GRAMS ? HEAVY_SURCHARGE : 0);
}
