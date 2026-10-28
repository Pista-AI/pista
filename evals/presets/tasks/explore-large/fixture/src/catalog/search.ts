import { PRODUCTS, type Product } from "./products.ts";

export function searchProducts(query: string): Product[] {
  const q = query.trim().toLowerCase();
  return PRODUCTS.filter((p) => p.name.toLowerCase().includes(q));
}
