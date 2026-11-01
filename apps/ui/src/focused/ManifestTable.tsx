import type { ManifestRow } from "./manifest.ts";

const STATUS_LABEL: Record<string, string> = {
  found: "Found",
  missing: "Not found",
  needs_login: "Needs your login",
  not_supported: "Download by hand",
};

export function ManifestTable({ rows }: { rows: ManifestRow[] }) {
  if (rows.length === 0) return <p>No invoices found.</p>;
  return (
    <table className="job-table">
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
