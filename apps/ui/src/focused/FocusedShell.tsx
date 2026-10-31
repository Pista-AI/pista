import { useEffect, useRef, useState } from "react";
import { Settings as Gear } from "lucide-react";
import { actions, threadById, toast, useApp } from "../lib/store.ts";
import { host } from "../lib/host.ts";
import { Transcript } from "../components/Transcript.tsx";
import { Composer } from "../components/Composer.tsx";
import { Workspace, WorkspaceTabs } from "../components/SidePanel.tsx";
import { SettingsDialog } from "../components/Settings.tsx";
import { AuthPromptDialog } from "../components/AuthPrompt.tsx";
import { ManifestTable, parseManifest, type ManifestRow } from "./ManifestTable.tsx";

const ROLE = "invoice-fetch";
const MANIFEST = "invoices/manifest.json";

/** One guided job for a small-business owner: paste transactions, watch the agent work, see the results. */
export function FocusedShell() {
  const { activeThreadId, threads, views, projects, draftProjectId } = useApp();
  const thread = threadById(threads, activeThreadId);
  const view = activeThreadId ? views[activeThreadId] : undefined;
  const project = projects.find((p) => p.id === (thread?.projectId ?? draftProjectId)) ?? projects[0];
  const [text, setText] = useState("");
  const [starting, setStarting] = useState(false);
  const [rows, setRows] = useState<ManifestRow[] | null>(null);
  // The manifest text at the start of this job, so an older run's results are not shown as this one's.
  const baseline = useRef<string | null>(null);
  const status = thread?.status;

  const readManifest = async (projectId: string) => {
    try {
      const file = await host.call("project.readFile", { projectId, relPath: MANIFEST });
      return file.exists ? (file.content ?? null) : null;
    } catch {
      return null;
    }
  };

  // Check for results when the thread goes idle (thread.updated moves status and updatedAt).
  useEffect(() => {
    if (!thread || !project || status === "running") return;
    let live = true;
    void readManifest(project.id).then((raw) => {
      const parsed = raw !== null && raw !== baseline.current ? parseManifest(raw) : null;
      if (live) setRows(parsed);
    });
    return () => {
      live = false;
    };
  }, [thread?.id, status, thread?.updatedAt, project?.id]);

  // The agent drives the browser through the panel, so make sure it has a tab to show.
  useEffect(() => {
    if (thread && !useApp.getState().panel.tabs.some((t) => t.kind === "web")) actions.newWebTab();
  }, [thread?.id]);

  const start = async () => {
    if (!project || !text.trim() || starting) return;
    setStarting(true);
    try {
      baseline.current = await readManifest(project.id);
      setRows(null);
      useApp.setState({ draftProjectId: project.id, activeThreadId: null });
      await actions.send(text.trim(), undefined, undefined, ROLE);
      setText("");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setStarting(false);
    }
  };

  const startOver = () => {
    setRows(null);
    setText("");
    actions.newThread(project?.id);
  };

  let body;
  if (!thread || !view) {
    body = (
      <div className="focused-step">
        <h1>Paste your transactions</h1>
        <p>Copy the lines from your bank statement or accounting software and paste them here. We never log in to your bank.</p>
        <textarea value={text} autoFocus placeholder="2026-09-03  Adobe  -59.99&#10;2026-09-05  Slack  -12.50" onChange={(e) => setText(e.target.value)} />
        <button className="pill-btn primary focused-go" disabled={!text.trim() || starting || !project} onClick={() => void start()}>
          {starting ? "Starting..." : "Start"}
        </button>
      </div>
    );
  } else if (rows) {
    body = (
      <div className="focused-step">
        <h1>Results</h1>
        <ManifestTable rows={rows} />
        <div className="focused-actions">
          <button className="pill-btn primary focused-go" onClick={() => host.call("project.reveal", { projectId: thread.projectId, relPath: "invoices" }).catch((e: Error) => toast(e.message, "error"))}>
            Open folder
          </button>
          <button className="link-btn" onClick={startOver}>
            Start over
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="focused-work">
        <section className="chat card focused-chat">
          <div className="focused-head">
            <h1>Working</h1>
            <button className="link-btn" onClick={startOver}>
              Start over
            </button>
          </div>
          <Transcript view={view} threadId={thread.id} />
          <Composer autoFocusKey={thread.id} placeholder="Reply here (for example: done)" />
        </section>
        <div className="focused-side">
          <WorkspaceTabs />
          <Workspace />
        </div>
      </div>
    );
  }

  return (
    <div className="focused">
      <button className="icon-btn focused-gear" title="Settings" aria-label="Settings" onClick={() => useApp.setState({ settingsOpen: "general" })}>
        <Gear size={18} />
      </button>
      {body}
      <SettingsDialog />
      <AuthPromptDialog />
    </div>
  );
}
