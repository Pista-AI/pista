export function gatewayLabel(count: number): string {
  return count === 1 ? "1 gateway" : `${count} gateways`;
}
