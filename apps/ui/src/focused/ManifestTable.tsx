export interface ManifestRow {
  vendor: string;
  date: string;
  amount: string;
  status: string;
  note: string;
}

const STATUS_LABEL: Record<string, string> = {
  found: "Found",
  missing: "Not found",
  needs_login: "Needs your login",
  not_supported: "Download by hand",
};

/** Reads invoices/manifest.json as the agent writes it (a list, or an object holding one); null when it is not a list. */
export function parseManifest(raw: string): ManifestRow[] | null {
  try {
    const data: unknown = JSON.parse(raw);
    const list = Array.isArray(data) ? data : (data as { entries?: unknown })?.entries;
    if (!Array.isArray(list)) return null;
    const text = (v: unknown) => (v === undefined || v === null ? "" : String(v));
    return list.map((e: Record<string, unknown>) => ({
      vendor: text(e.vendor),
      date: text(e.date),
      amount: [text(e.amount), text(e.currency)].filter(Boolean).join(" "),
      status: text(e.status),
      note: text(e.note),
    }));
  } catch {
    return null;
  }
}

export function ManifestTable({ rows }: { rows: ManifestRow[] }) {
  if (rows.length === 0) return <p>No invoices found.</p>;
  return (
    <table className="focused-table">
      <thead>
        <tr>
          <th>Vendor</th>
          <th>Date</th>
          <th>Amount</th>
          <th>Status</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.vendor}</td>
            <td>{r.date}</td>
            <td>{r.amount}</td>
            <td>{STATUS_LABEL[r.status] ?? r.status}</td>
            <td>{r.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
