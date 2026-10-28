export type Category = "kitchen" | "books" | "outdoor";

/** Books use the reduced VAT rate; everything else the standard one. */
export function isReducedVat(category: Category): boolean {
  return category === "books";
}
