import { useEffect, useState } from "react";
import type { ThreadSummary } from "@pista/protocol";
import { toast, useApp, type ThreadView } from "../lib/store.ts";
import { host } from "../lib/host.ts";
import { ManifestTable, parseManifest, type ManifestRow } from "./ManifestTable.tsx";

export const JOB_ROLE = "invoice-fetch";
const STATUS_WORD: Record<string, string> = { found: "Found", missing: "Missing", needs_login: "Needs your login", not_supported: "Not supported" };

export const useFocusedMode = () => useApp((s) => s.config?.focusedMode === true);

/** invoices/manifest.json of this job, re-read whenever the thread updates. A file older than the thread belongs to an earlier job and is ignored. */
function useManifest(thread: ThreadSummary | undefined): ManifestRow[] | null {
  const [rows, setRows] = useState<ManifestRow[] | null>(null);
  const isJob = thread?.role === JOB_ROLE;
  useEffect(() => {
    if (!thread || !isJob) return setRows(null);
    let live = true;
    host
      .call("project.readFile", { projectId: thread.projectId, relPath: "invoices/manifest.json" })
      .then((f) => live && setRows(f.exists && (f.modified ?? 0) >= thread.createdAt ? parseManifest(f.content ?? "") : null))
      .catch(() => live && setRows(null));
    return () => {
      live = false;
    };
  }, [thread?.id, thread?.status, thread?.updatedAt, isJob]);
  return rows;
}

/** Empty state of a new thread in focused mode; the composer below is the paste box. */
export function JobCard() {
  return (
    <div className="job-card">
      <h1>Fetch invoices</h1>
      <p>Paste the lines from your bank statement or accounting software below. We never log in to your bank.</p>
    </div>
  );
}

/** One chip per vendor while the job runs. */
export function JobStrip({ thread }: { thread: ThreadSummary | undefined }) {
  const rows = useManifest(thread);
  if (!rows?.length) return null;
  const vendors = new Map<string, string>();
  for (const r of rows) if (!vendors.has(r.vendor) || r.status !== "found") vendors.set(r.vendor, r.status);
  return (
    <div className="job-strip">
      {[...vendors].map(([vendor, status]) => (
        <span key={vendor} className={`job-chip ${status}`}>
          {vendor}: {STATUS_WORD[status] ?? status}
        </span>
      ))}
    </div>
  );
}

/** Last item of the transcript: the error card, or the results once the thread is idle with a manifest. */
export function JobFooter({ thread, view }: { thread: ThreadSummary; view: ThreadView }) {
  const rows = useManifest(thread);
  if (thread.role !== JOB_ROLE) return null;
  const last = view.messages[view.messages.length - 1];
  if (thread.status === "error" || (last?.role === "assistant" && last.stopReason === "error")) {
    return (
      <div className="job-error">
        <p>Something went wrong. Open settings to check your AI connection, then try again.</p>
        <button className="pill-btn primary" onClick={() => useApp.setState({ settingsOpen: "providers" })}>
          Open settings
        </button>
      </div>
    );
  }
  if (thread.status !== "idle" || !rows) return null;
  return (
    <div className="job-results">
      <h2>Results</h2>
      <ManifestTable rows={rows} />
      <button className="pill-btn primary" onClick={() => host.call("project.reveal", { projectId: thread.projectId }).catch((e: Error) => toast(e.message, "error"))}>
        Open folder
      </button>
    </div>
  );
}
