import { useEffect, useRef, useState } from "react";
import type { Playbook, PlaybookMeta } from "@pista/protocol";
import { host } from "../lib/host.ts";
import { useApp } from "../lib/store.ts";
import { describePendingWhy, describeRefusal, describeStart, describeSteps } from "../lib/playbooks.ts";

export const PLAYBOOKS_ANCHOR = "settings-playbooks";

/** Opens Settings (General tab) scrolled to the Playbooks section. */
export function openPlaybooksSettings() {
  useApp.setState({ settingsOpen: "general" });
  setTimeout(() => document.getElementById(PLAYBOOKS_ANCHOR)?.scrollIntoView({ block: "start" }), 50);
}

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
  const openRef = useRef<string | null>(null);

  const refresh = async () => {
    try {
      const list = await host.call("playbook.list", {});
      if (alive.current) {
        setItems(list);
        setError(null);
      }
    } catch (e) {
      if (alive.current) {
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
    if (open === site) {
      openRef.current = null;
      return setOpen(null);
    }
    openRef.current = site;
    setKwInput("");
    setNoteInput("");
    setKwError(null);
    setOpen(site);
    setDetail(undefined);
    try {
      const pb = await host.call("playbook.get", { site });
      if (alive.current && openRef.current === site) setDetail(pb);
    } catch (e) {
      if (alive.current && openRef.current === site) {
        setDetail(null);
        setError(errText(e));
      }
    }
  };
  const [noteInput, setNoteInput] = useState("");
  /** Runs a notes change, then reloads the opened playbook so the list shows it. */
  const changeNotes = async (site: string, fn: () => Promise<unknown>, clear = false) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (clear) setNoteInput("");
      const pb = await host.call("playbook.get", { site });
      if (alive.current && openRef.current === site) setDetail(pb);
      await refresh();
    } catch (e) {
      if (alive.current) setError(errText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const [kwInput, setKwInput] = useState("");
  const [kwError, setKwError] = useState<string | null>(null);
  /** Runs a keyword change; the host's answer is the only judge of a typed keyword. */
  const changeKeywords = async (site: string, fn: () => Promise<string | null>) => {
    setBusy(true);
    setKwError(null);
    try {
      const refusal = await fn();
      if (refusal) setKwError(refusal);
      else setKwInput("");
      await refresh();
    } catch (e) {
      if (alive.current) setKwError(errText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const setList = async (site: string, merchants: string[], typed?: string) => {
    const r = await host.call("playbook.setMerchants", { site, merchants });
    const bad = typed === undefined ? undefined : r.refused.find((x) => x.merchant === typed);
    return bad ? describeRefusal(bad.merchant, bad.reason) : null;
  };
  const remove = async (site: string) => {
    setConfirming(null);
    setError(null);
    setBusy(true);
    try {
      await host.call("playbook.delete", { site });
      if (open === site) {
        openRef.current = null;
        setOpen(null);
      }
      await refresh();
    } catch (e) {
      if (alive.current) setError(errText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div className="field playbooks" id={PLAYBOOKS_ANCHOR}>
      <label>Playbooks</label>
      <span className="help">Steps Pista learned for sites you use. It follows them next time and repairs them when a site changes.</span>
      {!error && items?.length === 0 && <span className="help">No playbooks yet. Pista saves one after a successful invoice download.</span>}
      {error && <div role="alert" className="login-error">{error}</div>}
      {items?.map((p) => (
        <div key={p.site}>
          <div className="login-row">
            <div className="login-info">
              <strong>{p.site}</strong>
              {p.hosts && <small>Also visits {p.hosts.slice(1).join(", ")}</small>}
              <small>{p.stepCount === 0 ? "No saved path yet" : `${p.stepCount === 1 ? "1 step" : `${p.stepCount} steps`} · ${lastSucceeded(p.lastSucceeded)}`}</small>
              {describeStart(p.startUrl, p.shortcutUrl).map((line) => <small key={line}>{line}</small>)}
            </div>
            <span className="playbook-actions">
              <span className={`playbook-chip ${p.status === "ok" ? "ok" : "bad"}`}>{p.status === "ok" ? "OK" : "Needs attention"}</span>
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
            <div className="playbook-steps playbook-keywords">
              <strong>Bank keywords</strong>
              <span className="help">Transaction lines that contain these go to this site. Use * for any text in between.</span>
              <div className="kw-chips">
                {(p.merchants ?? []).map((k) => (
                  <span key={k} className="kw-chip ok">{k}
                    <button type="button" aria-label={`Remove ${k}`} disabled={busy} onClick={() => changeKeywords(p.site, () => setList(p.site, (p.merchants ?? []).filter((m) => m !== k)))}>×</button>
                  </span>
                ))}
                {(p.merchantsPending ?? []).map((k) => {
                  const why = describePendingWhy(p.merchantsPendingWhy?.[k]);
                  return (
                    <span key={k} className="kw-chip pending" title={why}>{k} <em>pending</em>
                      <button type="button" aria-label={`Confirm ${k}`} disabled={busy} onClick={() => changeKeywords(p.site, () => setList(p.site, [...(p.merchants ?? []), k], k))}>✓</button>
                      <button type="button" aria-label={`Dismiss ${k}`} disabled={busy} onClick={() => changeKeywords(p.site, async () => { await host.call("playbook.dismissMerchant", { site: p.site, merchant: k }); return null; })}>×</button>
                    </span>
                  );
                })}
              </div>
              {(p.merchantsPending ?? []).map((k) => {
                const why = describePendingWhy(p.merchantsPendingWhy?.[k]);
                return why ? <small key={k} className="kw-why">{k}: {why}</small> : null;
              })}
              <form className="kw-add" onSubmit={(e) => { e.preventDefault(); const t = kwInput.trim(); if (t) void changeKeywords(p.site, () => setList(p.site, [...(p.merchants ?? []), t], t)); }}>
                <input value={kwInput} placeholder="paypal*telnyx" aria-label={`Add a bank keyword for ${p.site}`} onChange={(e) => { setKwInput(e.target.value); setKwError(null); }} />
                <button type="submit" className="pill-btn" disabled={busy || !kwInput.trim()}>Add</button>
              </form>
              {kwError && <div role="alert" className="login-error">{kwError}</div>}
            </div>
          )}
          {open === p.site && (
            <div className="playbook-steps playbook-keywords">
              <strong>Notes</strong>
              <span className="help">Facts for later runs. They are shown to the model as information, never followed as steps. No passwords or personal data.</span>
              {detail?.notes.map((n, i) => (
                <small key={`n${i}`}>{n.text} ({n.by === "user" ? "you" : "Pista"}, {n.at.slice(0, 10)})
                  <button type="button" className="pill-btn" aria-label={`Delete note ${i + 1} for ${p.site}`} disabled={busy} onClick={() => changeNotes(p.site, () => host.call("playbook.removeNote", { site: p.site, index: i }))}>Delete</button>
                </small>
              ))}
              {detail && detail.avoid.length > 0 && <strong>Avoid</strong>}
              {detail?.avoid.map((a, i) => (
                <small key={`a${i}`}>{a.url}: {a.why}
                  <button type="button" className="pill-btn" aria-label={`Delete avoid entry ${i + 1} for ${p.site}`} disabled={busy} onClick={() => changeNotes(p.site, () => host.call("playbook.removeAvoid", { site: p.site, index: i }))}>Delete</button>
                </small>
              ))}
              <form className="kw-add" onSubmit={(e) => { e.preventDefault(); const t = noteInput.trim(); if (t) void changeNotes(p.site, () => host.call("playbook.addNote", { site: p.site, text: t }), true); }}>
                <input value={noteInput} maxLength={200} placeholder="Invoices live on another portal" aria-label={`Add a note for ${p.site}`} onChange={(e) => setNoteInput(e.target.value)} />
                <button type="submit" className="pill-btn" disabled={busy || !noteInput.trim()}>Add note</button>
              </form>
            </div>
          )}
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
