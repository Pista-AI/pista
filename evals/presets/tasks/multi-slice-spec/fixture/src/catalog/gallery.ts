/** gallery codes are upper-case and prefixed. */
export function formatGallery(value: string): string {
  return "GAL-" + value.trim().toUpperCase();
}
