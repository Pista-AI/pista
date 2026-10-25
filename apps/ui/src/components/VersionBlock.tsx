import type { VersionGate } from "@pista/protocol";
import { ShieldAlert } from "lucide-react";
import { useApp } from "../lib/store.ts";

/** Replaces the thread area when the managed policy disallows this app version. Settings stay reachable. */
export function VersionBlock({ gate, message }: { gate?: VersionGate; message: string | null }) {
  const structured = gate && gate.status !== "ok" ? gate : undefined;
  return (
    <div className="empty version-block" role="alert">
      <ShieldAlert size={28} className="version-block-icon" />
      <h1>This version of Pista is not allowed</h1>
      {structured ? (
        <dl className="version-block-facts">
          <dt>Current version</dt>
          <dd>{structured.current}</dd>
          {structured.minimumVersion && (
            <>
              <dt>Minimum allowed</dt>
              <dd>{structured.minimumVersion}</dd>
            </>
          )}
          {structured.maximumVersion && (
            <>
              <dt>Maximum allowed</dt>
              <dd>{structured.maximumVersion}</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="version-block-message">{message || "Contact your IT administrator."}</p>
      )}
      <p>
        <strong>{structured?.status === "above" ? "Install the approved version" : "Update Pista"}</strong> or contact your IT administrator.
      </p>
      <button className="pill-btn" onClick={() => useApp.setState({ settingsOpen: "general" })}>
        Open Settings
      </button>
    </div>
  );
}
