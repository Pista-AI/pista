export function isChannelValid(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 108;
}
