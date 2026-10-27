import { findProduct } from "../catalog/lookup.ts";

export interface CartLine {
  productId: string;
  qty: number;
}

export interface Cart {
  lines: CartLine[];
}

export function emptyCart(): Cart {
  return { lines: [] };
}

export function addLine(cart: Cart, productId: string, qty = 1): Cart {
  findProduct(productId);
  const existing = cart.lines.find((l) => l.productId === productId);
  if (existing) return { lines: cart.lines.map((l) => (l === existing ? { ...l, qty: l.qty + qty } : l)) };
  return { lines: [...cart.lines, { productId, qty }] };
}

export function removeLine(cart: Cart, productId: string): Cart {
  return { lines: cart.lines.filter((l) => l.productId !== productId) };
}
