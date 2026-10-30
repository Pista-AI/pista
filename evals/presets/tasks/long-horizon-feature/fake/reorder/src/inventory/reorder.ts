import { available } from "./stock.ts";

export function reorderQuantity(stock: { onHand: number; reserved: number; dailyDemand: number }, leadDays: number, safetyDays = 2): number {
  const need = Math.ceil(stock.dailyDemand * (leadDays + safetyDays));
  return Math.max(0, need - available(stock));
}
