import { useEffect, useRef, useState } from "react";
import type { Playbook, PlaybookMeta } from "@pista/protocol";
import { host } from "../lib/host.ts";
import { describeSteps } from "../lib/playbooks.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function lastSucceeded(iso?: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? "not succeeded yet" : `last succeeded ${new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Settings section listing the site playbooks the host learned. Content comes from web pages: shown as text only. */
export function Playbooks() {
  const [items, setItems] = useState<PlaybookMeta[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Playbook | null | undefined>(undefined);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = async () => {
    try {
      const list = await host.call("playbook.list", {});
      if (alive.current) setItems(list);
    } catch (e) {
      if (alive.current) {
        setItems((prev) => prev ?? []);
        setError(errText(e));
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, []);

  const toggle = async (site: string) => {
    if (open === site) return setOpen(null);
    setOpen(site);
    setDetail(undefined);
    try {
      const pb = await host.call("playbook.get", { site });
      if (alive.current) setDetail(pb);
    } catch (e) {
      if (alive.current) {
        setDetail(null);
        setError(errText(e));
      }
    }
  };
  const remove = async (site: string) => {
    setConfirming(null);
    setError(null);
    setBusy(true);
    try {
      await host.call("playbook.delete", { site });
      if (open === site) setOpen(null);
      await refresh();
    } catch (e) {
      if (alive.current) setError(errText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div className="field playbooks">
      <label>Playbooks</label>
      <span className="help">Steps Pista learned for sites you use. It follows them next time and repairs them when a site changes.</span>
      {items?.length === 0 && <span className="help">No playbooks yet. Pista saves one after a successful invoice download.</span>}
      {error && <div role="alert" className="login-error">{error}</div>}
      {items?.map((p) => (
        <div key={p.site}>
          <div className="login-row">
            <div className="login-info">
              <strong>{p.site}</strong>
              <small>{p.stepCount === 1 ? "1 step" : `${p.stepCount} steps`} · {lastSucceeded(p.lastSucceeded)}</small>
            </div>
            <span className="playbook-actions">
              <span className={`pb-chip ${p.status === "ok" ? "ok" : "bad"}`}>{p.status === "ok" ? "OK" : "Needs attention"}</span>
              <button type="button" className="pill-btn" aria-expanded={open === p.site} aria-label={`Steps for ${p.site}`} onClick={() => toggle(p.site)}>Steps</button>
              {confirming === p.site ? (
                <span className="login-confirm">
                  Delete?
                  <button type="button" className="pill-btn danger" aria-label={`Yes, delete ${p.site}`} disabled={busy} onClick={() => remove(p.site)}>Yes</button>
                  <button type="button" className="pill-btn" disabled={busy} onClick={() => setConfirming(null)}>No</button>
                </span>
              ) : (
                <button type="button" className="pill-btn" aria-label={`Delete ${p.site}`} disabled={busy} onClick={() => setConfirming(p.site)}>Delete</button>
              )}
            </span>
          </div>
          {open === p.site && (
            <div className="playbook-steps">
              {detail === undefined ? <span className="help">Loading…</span> : detail === null ? <span className="help">Could not load the steps.</span> : (
                <ol>{describeSteps(detail.steps).map((line, i) => <li key={i}>{line}</li>)}</ol>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
