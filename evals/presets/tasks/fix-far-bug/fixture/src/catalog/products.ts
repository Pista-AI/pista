export interface Product {
  id: string;
  name: string;
  netCents: number; // price in the customer's invoice currency
}

export const PRODUCTS: Product[] = [
  { id: "licence", name: "Annual licence", netCents: 120000 },
  { id: "support", name: "Support hours (10)", netCents: 45000 },
  { id: "setup", name: "Setup", netCents: 15000 },
];

export function findProduct(id: string): Product {
  const product = PRODUCTS.find((p) => p.id === id);
  if (!product) throw new Error(`unknown product ${id}`);
  return product;
}
