import { findProduct } from "../catalog/products.ts";
import { multiply, sum, type Price } from "../money/price.ts";

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

export function lineTotal(line: CartLine): Price {
  return multiply(findProduct(line.productId).price, line.qty);
}

export function cartTotal(cart: Cart): Price {
  return sum(cart.lines.map(lineTotal));
}
