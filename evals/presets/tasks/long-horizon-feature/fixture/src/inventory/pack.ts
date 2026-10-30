export function packLabel(count: number): string {
  return count === 1 ? "1 pack" : `${count} packs`;
}
