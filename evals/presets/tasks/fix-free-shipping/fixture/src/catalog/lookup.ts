import { PRODUCTS, type Product } from "./products.ts";

export function findProduct(id: string): Product {
  const product = PRODUCTS.find((p) => p.id === id);
  if (!product) throw new Error(`unknown product ${id}`);
  return product;
}
