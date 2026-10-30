export function churnLabel(count: number): string {
  return count === 1 ? "1 churn" : `${count} churns`;
}
