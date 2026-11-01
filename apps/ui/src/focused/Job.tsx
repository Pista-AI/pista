import { useEffect, useRef, useState } from "react";
import type { ThreadSummary } from "@pista/protocol";
import { toast, useApp, type ThreadView } from "../lib/store.ts";
import { host } from "../lib/host.ts";
import { ManifestTable } from "./ManifestTable.tsx";
import { parseManifest, type ManifestRow } from "./manifest.ts";

export const JOB_ROLE = "invoice-fetch";
const STATUS_WORD: Record<string, string> = { pending: "Waiting", found: "Found", missing: "Missing", needs_login: "Needs your login", not_supported: "Not supported" };

export const useFocusedMode = () => useApp((s) => s.config?.focusedMode === true);

/** invoices/manifest.json of this job. Re-read when the thread updates or new messages arrive, at most every 2 s; a file older than the thread belongs to an earlier job and is ignored. */
function useManifest(thread: ThreadSummary | undefined): ManifestRow[] | null {
  const [rows, setRows] = useState<ManifestRow[] | null>(null);
  const isJob = thread?.role === JOB_ROLE;
  const messages = useApp((s) => (thread ? s.views[thread.id]?.messages.length : 0));
  const last = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!thread || !isJob) return setRows(null);
    let live = true;
    const read = () => {
      last.current = Date.now();
      host
        .call("project.readFile", { projectId: thread.projectId, relPath: "invoices/manifest.json" })
        .then((f) => live && setRows(f.exists && (f.modified ?? 0) >= thread.createdAt ? parseManifest(f.content ?? "") : null))
        .catch(() => live && setRows(null));
    };
    const wait = Math.max(0, last.current + 2000 - Date.now());
    if (wait === 0 || thread.status !== "running") read();
    else timer.current = window.setTimeout(read, wait);
    return () => {
      live = false;
      window.clearTimeout(timer.current);
    };
  }, [thread?.id, thread?.status, thread?.updatedAt, messages, isJob]);
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
  if (thread.status !== "idle" || !rows || rows.some((r) => r.status === "pending")) return null;
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
