export function voucherLabel(count: number): string {
  return count === 1 ? "1 voucher" : `${count} vouchers`;
}
