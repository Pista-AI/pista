const STOCK = new Map<string, number>([
  ["mug-01", 40],
  ["pot-02", 6],
  ["book-03", 25],
  ["lamp-04", 0],
]);

export function inStock(productId: string): number {
  return STOCK.get(productId) ?? 0;
}
