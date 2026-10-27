import { sek } from "../money.ts";
import type { Category } from "./categories.ts";

export interface Product {
  id: string;
  name: string;
  priceCents: number;
  weightGrams: number;
  category: Category;
}

export const PRODUCTS: Product[] = [
  { id: "mug-01", name: "Enamel mug", priceCents: sek(129), weightGrams: 300, category: "kitchen" },
  { id: "pot-02", name: "Cast iron pot", priceCents: sek(649), weightGrams: 4200, category: "kitchen" },
  { id: "book-03", name: "Field guide", priceCents: sek(199), weightGrams: 450, category: "books" },
  { id: "lamp-04", name: "Head lamp", priceCents: sek(349), weightGrams: 120, category: "outdoor" },
  { id: "tent-05", name: "Two-person tent", priceCents: sek(1890), weightGrams: 2300, category: "outdoor" },
];
