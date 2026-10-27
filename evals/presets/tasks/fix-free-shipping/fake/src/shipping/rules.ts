/** Orders whose discounted subtotal reaches this many SEK ship free. */
export const FREE_SHIPPING_OVER = 500;

export function shipsFree(subtotalCents: number): boolean {
  return subtotalCents >= FREE_SHIPPING_OVER * 100;
}
