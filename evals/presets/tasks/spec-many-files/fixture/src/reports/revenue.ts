import { sum, type Price } from "../money/price.ts";

export interface PaidOrder {
  id: string;
  total: Price;
}

export function totalRevenue(orders: PaidOrder[]): Price {
  return sum(orders.map((o) => o.total));
}
