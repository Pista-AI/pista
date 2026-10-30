export function forecastLabel(count: number): string {
  return count === 1 ? "1 forecast" : `${count} forecasts`;
}
