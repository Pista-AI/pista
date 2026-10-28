import { price, type Price } from "../money/price.ts";

export interface PriceJson {
  amountCents: number;
}

export function priceToJson(p: Price): PriceJson {
  return { amountCents: p.amountCents };
}

export function priceFromJson(json: PriceJson): Price {
  return price(json.amountCents);
}
