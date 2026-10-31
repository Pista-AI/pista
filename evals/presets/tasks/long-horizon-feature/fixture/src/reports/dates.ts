/** The UTC calendar day (YYYY-MM-DD) of an ISO timestamp. */
export function dayOf(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}
