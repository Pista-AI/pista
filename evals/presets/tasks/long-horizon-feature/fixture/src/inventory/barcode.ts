export function barcodeLabel(count: number): string {
  return count === 1 ? "1 barcode" : `${count} barcodes`;
}
