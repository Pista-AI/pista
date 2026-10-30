export interface OrderLine {
  sku: string;
  qty: number;
  unitCents: number;
}

export function lineTotal(line: OrderLine): number {
  return line.qty * line.unitCents;
}

export function orderSubtotal(lines: OrderLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}
