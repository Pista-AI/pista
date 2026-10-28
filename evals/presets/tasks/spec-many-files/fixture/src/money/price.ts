export interface Price {
  amountCents: number;
}

export function price(amountCents: number): Price {
  return { amountCents };
}

export function zero(): Price {
  return price(0);
}

export function add(a: Price, b: Price): Price {
  return price(a.amountCents + b.amountCents);
}

export function sum(prices: Price[]): Price {
  return prices.reduce(add, zero());
}

export function multiply(p: Price, factor: number): Price {
  return price(Math.round(p.amountCents * factor));
}

export function negate(p: Price): Price {
  return price(-p.amountCents);
}
