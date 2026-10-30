export function writeoffLabel(count: number): string {
  return count === 1 ? "1 writeoff" : `${count} writeoffs`;
}
