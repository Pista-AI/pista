import { addDays } from "../calendar/weekdays.ts";
import { dispatchDate } from "../shipping/dispatch.ts";
import { TRANSIT_DAYS } from "../shipping/rates.ts";
import { zoneFor } from "../shipping/zones.ts";
import type { Order } from "./order.ts";

/** When the parcel should arrive: dispatch day plus the zone's transit days. */
export function estimateDelivery(order: Order): Date {
  return addDays(dispatchDate(order.placedAt), TRANSIT_DAYS[zoneFor(order.shipTo.country)]);
}
