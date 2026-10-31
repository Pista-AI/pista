export interface Stock {
  onHand: number;
  reserved: number;
}

/** Units that can still be promised to a customer; never negative. */
export function available(stock: Stock): number {
  return Math.max(0, stock.onHand - stock.reserved);
}

export function isLow(stock: Stock, threshold = 5): boolean {
  return available(stock) <= threshold;
}
