import type { CartLine } from "../cart/cart.ts";
import type { Address } from "../customers/addresses.ts";

export interface Order {
  id: string;
  customerId: string;
  lines: CartLine[];
  totalCents: number;
  shippingCents: number;
  shipTo: Address;
  placedAt: Date;
  /** The day the order leaves the warehouse (00:00 UTC). */
  shipOn: Date;
}
