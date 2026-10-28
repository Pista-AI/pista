import { PRODUCTS, type Product } from "./products.ts";

export function findProduct(sku: string): Product {
  const product = PRODUCTS.find((p) => p.sku === sku);
  if (!product) throw new Error(`unknown product ${sku}`);
  return product;
}
