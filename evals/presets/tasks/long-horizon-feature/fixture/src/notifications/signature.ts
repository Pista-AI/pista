export function signatureLabel(count: number): string {
  return count === 1 ? "1 signature" : `${count} signatures`;
}
