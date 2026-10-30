export function unsubscribeLabel(count: number): string {
  return count === 1 ? "1 unsubscribe" : `${count} unsubscribes`;
}
