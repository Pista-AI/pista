import { findProduct } from "../catalog/products.ts";

export interface InvoiceLine {
  productId: string;
  name: string;
  qty: number;
  netCents: number;
}

export function buildLines(items: { productId: string; qty: number }[]): InvoiceLine[] {
  return items.map(({ productId, qty }) => {
    const product = findProduct(productId);
    return { productId, name: product.name, qty, netCents: product.netCents * qty };
  });
}
