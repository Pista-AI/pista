export interface Price {
  amountCents: number;
  currency: string;
}

export function price(amountCents: number, currency = "EUR"): Price {
  return { amountCents, currency };
}

export function zero(currency = "EUR"): Price {
  return price(0, currency);
}

export function add(a: Price, b: Price): Price {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  return price(a.amountCents + b.amountCents, a.currency);
}

export function sum(prices: Price[]): Price {
  const [first, ...rest] = prices;
  if (!first) return zero();
  return rest.reduce(add, first);
}

export function multiply(p: Price, factor: number): Price {
  return price(Math.round(p.amountCents * factor), p.currency);
}

export function negate(p: Price): Price {
  return price(-p.amountCents, p.currency);
}
