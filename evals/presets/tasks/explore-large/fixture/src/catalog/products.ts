export interface Product {
  id: string;
  name: string;
  priceCents: number;
  weightGrams: number;
  categoryId: string;
}

export const PRODUCTS: Product[] = [
  { id: "mug-01", name: "Stoneware mug", priceCents: 12900, weightGrams: 400, categoryId: "kitchen" },
  { id: "pot-02", name: "Cast iron pot", priceCents: 64900, weightGrams: 4200, categoryId: "kitchen" },
  { id: "book-03", name: "Field guide to mushrooms", priceCents: 19900, weightGrams: 650, categoryId: "books" },
  { id: "lamp-04", name: "Desk lamp", priceCents: 34900, weightGrams: 1100, categoryId: "home" },
];

export function findProduct(id: string): Product {
  const product = PRODUCTS.find((p) => p.id === id);
  if (!product) throw new Error(`unknown product ${id}`);
  return product;
}
