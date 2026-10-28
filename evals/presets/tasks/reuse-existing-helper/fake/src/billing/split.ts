import { allocate } from "../lib/allocate.ts";

/** Divides a bill between `parts` people; the extra cents go to the earliest entries. */
export function splitBill(totalCents: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError("parts must be a positive integer");
  return allocate(totalCents, new Array<number>(parts).fill(1));
}
