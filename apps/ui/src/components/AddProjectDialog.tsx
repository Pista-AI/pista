import { useState } from "react";
import { actions, toast } from "../lib/store.ts";

export function AddProjectDialog({ onClose }: { onClose: () => void }) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const chosen = await window.pistaDesktop?.pickFolder?.();
    if (chosen) setPath(chosen);
  };

  const submit = async () => {
    setBusy(true);
    try {
      await actions.addProject(path);
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <h3 style={{ margin: 0 }}>Add project folder</h3>
        <p className="sub" style={{ margin: 0, color: "var(--text-3)" }}>
          Threads run with this folder as the working directory. Pi tools (read, edit, bash) operate inside it.
        </p>
        <div className="field" style={{ borderBottom: 0, paddingBottom: 0 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              autoFocus
              placeholder="~/Projects/my-app"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && path && submit()}
            />
            {window.pistaDesktop?.pickFolder && (
              <button className="pill-btn" onClick={pick}>
                Browse…
              </button>
            )}
          </div>
        </div>
        <div className="btn-row">
          <button className="pill-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="pill-btn primary" disabled={!path || busy} onClick={submit}>
            Add folder
          </button>
        </div>
      </div>
    </div>
  );
}
