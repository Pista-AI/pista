export function warehouseLabel(count: number): string {
  return count === 1 ? "1 warehouse" : `${count} warehouses`;
}
