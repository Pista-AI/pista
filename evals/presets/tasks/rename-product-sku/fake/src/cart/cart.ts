import { findProduct } from "../catalog/lookup.ts";

export interface CartLine {
  sku: string;
  qty: number;
}

export interface Cart {
  lines: CartLine[];
}

export function emptyCart(): Cart {
  return { lines: [] };
}

export function addLine(cart: Cart, sku: string, qty = 1): Cart {
  findProduct(sku);
  const existing = cart.lines.find((l) => l.sku === sku);
  if (existing) return { lines: cart.lines.map((l) => (l === existing ? { ...l, qty: l.qty + qty } : l)) };
  return { lines: [...cart.lines, { sku, qty }] };
}

export function removeLine(cart: Cart, sku: string): Cart {
  return { lines: cart.lines.filter((l) => l.sku !== sku) };
}
