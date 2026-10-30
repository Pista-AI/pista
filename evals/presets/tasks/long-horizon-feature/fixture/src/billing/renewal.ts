export function renewalLabel(count: number): string {
  return count === 1 ? "1 renewal" : `${count} renewals`;
}
