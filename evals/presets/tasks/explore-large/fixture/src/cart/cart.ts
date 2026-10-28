import { findProduct } from "../catalog/products.ts";

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
  return { lines: [...cart.lines, { productId, qty }] };
}
