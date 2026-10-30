/** webhook codes are upper-case and prefixed. */
export function formatWebhook(value: string): string {
  return "WEB-" + value.trim().toUpperCase();
}
