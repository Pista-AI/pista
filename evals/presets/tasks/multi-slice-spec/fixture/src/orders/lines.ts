export interface OrderLine {
  sku: string;
  qty: number;
  unitCents: number;
}

export function lineTotal(line: OrderLine): number {
  return line.qty * line.unitCents;
}
