export interface ManifestRow {
  vendor: string;
  date: string;
  amount: string;
  status: string;
  note: string;
}

/** The list inside a manifest: a bare array, or an object's `entries`, `transactions`, `items` or `invoices` array, or its only array-valued key. */
function manifestList(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  for (const key of ["entries", "transactions", "items", "invoices"]) if (Array.isArray(obj[key])) return obj[key] as unknown[];
  const arrays = Object.values(obj).filter(Array.isArray);
  return arrays.length === 1 ? (arrays[0] as unknown[]) : null;
}

/** Reads invoices/manifest.json as the agent writes it; null when it holds no list. Missing fields default to empty, status to pending. */
export function parseManifest(raw: string): ManifestRow[] | null {
  try {
    const list = manifestList(JSON.parse(raw));
    if (!list) return null;
    const text = (v: unknown) => (v === undefined || v === null ? "" : String(v));
    return list.map((e) => {
      const r = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
      return {
        vendor: text(r.vendor),
        date: text(r.date),
        amount: [text(r.amount), text(r.currency)].filter(Boolean).join(" "),
        status: text(r.status) || "pending",
        note: text(r.note),
      };
    });
  } catch {
    return null;
  }
}
