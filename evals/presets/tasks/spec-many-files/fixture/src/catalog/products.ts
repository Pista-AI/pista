import { price, type Price } from "../money/price.ts";

export interface Product {
  id: string;
  name: string;
  price: Price;
}

export const PRODUCTS: Product[] = [
  { id: "mug", name: "Mug", price: price(1250) },
  { id: "lamp", name: "Lamp", price: price(4900) },
  { id: "book", name: "Book", price: price(1990) },
];

export function findProduct(id: string): Product {
  const product = PRODUCTS.find((p) => p.id === id);
  if (!product) throw new Error(`unknown product ${id}`);
  return product;
}
