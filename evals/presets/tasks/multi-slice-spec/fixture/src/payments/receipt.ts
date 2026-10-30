export function receiptLabel(count: number): string {
  return count === 1 ? "1 receipt" : `${count} receipts`;
}
