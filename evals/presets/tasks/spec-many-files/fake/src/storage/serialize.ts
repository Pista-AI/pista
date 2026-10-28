import { price, type Price } from "../money/price.ts";

export interface PriceJson {
  amountCents: number;
  currency?: string;
}

export function priceToJson(p: Price): PriceJson {
  return { amountCents: p.amountCents, currency: p.currency };
}

/** JSON stored before currencies existed has no `currency`; it was EUR. */
export function priceFromJson(json: PriceJson): Price {
  return price(json.amountCents, json.currency ?? "EUR");
}
