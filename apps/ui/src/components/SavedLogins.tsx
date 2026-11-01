import { useEffect, useRef, useState } from "react";
import type { SavedLoginMeta } from "@pista/protocol";
import { useConfigField } from "../lib/useConfigField.ts";
import { formatImportResult, hostOf, validateLoginInput } from "../focused/saved-logins.ts";

const EMPTY = { label: "", loginUrl: "", username: "", password: "" };

/**
 * Settings section for saved sign-ins. Talks to the desktop main process directly (never the agent host).
 * The password lives in React state only until Save, then goes straight to the bridge and is cleared.
 * It is never logged, put in a URL, stored in localStorage, or sent in any protocol/RPC call.
 */
export function SavedLogins() {
  const logins = window.pistaDesktop?.browser?.logins;
  const [available, setAvailable] = useState<boolean | null>(null);
  const [items, setItems] = useState<SavedLoginMeta[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [trash, setTrash] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState("");
  const [presence, setPresence] = useState<"touchid" | "unavailable" | null>(null);
  const confirmSignIns = useConfigField("confirmSignIns");
  const alive = useRef(true);

  const refresh = async () => {
    if (!logins) return;
    setError(null);
    try {
      const list = await logins.list();
      if (alive.current) setItems(list);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    alive.current = true;
    if (logins) {
      logins.status().then(
        (s) => {
          if (!alive.current) return;
          setAvailable(s.available);
          setPresence(s.presence ?? null);
        },
        () => alive.current && setAvailable(false),
      );
      void refresh();
    }
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ready = available === true;

  if (!logins) {
    return (
      <div className="field">
        <label>Saved logins</label>
        <span className="help">Saved logins need the desktop app.</span>
      </div>
    );
  }

  const aria = { "aria-invalid": error ? true : undefined, "aria-describedby": error ? "login-error" : undefined };
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateLoginInput(form);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      await logins.save({ ...form, label: form.label.trim(), loginUrl: form.loginUrl.trim(), username: form.username.trim() });
      if (alive.current) setForm(EMPTY);
      await refresh();
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const remove = async (id: string) => {
    setConfirming(null);
    setError(null);
    setRemoving(true);
    try {
      await logins.remove(id);
      await refresh();
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (alive.current) setRemoving(false);
    }
  };

  const runImport = async () => {
    setImporting(true);
    setError(null);
    setImportNote("");
    try {
      const r = await logins.import({ trash });
      if (alive.current) setImportNote(formatImportResult(r, trash));
      await refresh();
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (alive.current) setImporting(false);
    }
  };

  return (
    <div className="field saved-logins">
      <label>Saved logins</label>
      <span className="help">Pista signs in to these sites for you. Passwords are kept in your computer's keychain and are never shown to the AI.</span>
      <div className="field-row">
        <label>Ask before each sign-in</label>
        <div className="seg">
          {([true, false] as const).map((on) => (
            <button key={String(on)} type="button" className={(confirmSignIns.value !== false) === on ? "on" : ""} disabled={confirmSignIns.locked} onClick={() => confirmSignIns.set(on)}>
              {on ? "On" : "Off"}
            </button>
          ))}
        </div>
        <span className="help">Pista asks you to approve every time it signs in with a saved login, even when it otherwise acts without asking.</span>
      </div>
      {presence && (
        <span className="help">{presence === "touchid" ? "Touch ID is asked once each time you open Pista, before its first sign-in." : "Touch ID not available on this device."}</span>
      )}
      {available === false && <div role="alert" className="login-error">Pista can't store passwords safely on this computer, so saving logins is turned off.</div>}
      {items.length === 0 && ready && <span className="help">No saved logins yet.</span>}
      {items.map((l) => (
        <div className="login-row" key={l.id}>
          <div className="login-info">
            <strong>{l.label}</strong>
            <small>{hostOf(l.origin)}{l.username ? ` · ${l.username}` : ""}</small>
          </div>
          {confirming === l.id ? (
            <span className="login-confirm">
              Remove?
              <button type="button" className="pill-btn danger" aria-label={`Yes, remove ${l.label}`} disabled={removing} onClick={() => remove(l.id)}>Yes</button>
              <button type="button" className="pill-btn" disabled={removing} onClick={() => setConfirming(null)}>No</button>
            </span>
          ) : (
            <button type="button" className="pill-btn" aria-label={`Remove ${l.label}`} disabled={removing} onClick={() => setConfirming(l.id)}>Remove</button>
          )}
        </div>
      ))}
      <form className="login-form" onSubmit={save}>
        <label htmlFor="login-label">Site name</label>
        <input {...aria} id="login-label" value={form.label} onChange={set("label")} disabled={!ready || busy} maxLength={80} />
        <label htmlFor="login-url">Sign-in page address</label>
        <input {...aria} id="login-url" value={form.loginUrl} onChange={set("loginUrl")} placeholder="https://…" disabled={!ready || busy} />
        <label htmlFor="login-user">Username or email</label>
        <input {...aria} id="login-user" value={form.username} onChange={set("username")} autoComplete="off" disabled={!ready || busy} />
        <label htmlFor="login-pass">Password</label>
        <input {...aria} id="login-pass" type="password" value={form.password} onChange={set("password")} autoComplete="new-password" disabled={!ready || busy} />
        <span className="help">The password is never shown again. To change a login, save it again with the same sign-in page address.</span>
        {error && <div role="alert" id="login-error" className="login-error">{error}</div>}
        <div>
          <button type="submit" className="pill-btn primary" disabled={!ready || busy}>Save login</button>
        </div>
      </form>
      <div className="login-import">
        <strong>Import from a file</strong>
        <span className="help">Export your passwords from Chrome, Firefox, Safari, Bitwarden or 1Password as a CSV file, then import it here. Only website logins are imported, and the file is read by the desktop app only.</span>
        <label className="login-trash">
          <input type="checkbox" checked={trash} onChange={(e) => setTrash(e.target.checked)} disabled={!ready || importing} /> Move the file to the Trash after importing
        </label>
        <div>
          <button type="button" className="pill-btn" disabled={!ready || importing} onClick={runImport}>Choose file and import</button>
        </div>
        {importNote && <span className="help" role="status">{importNote}</span>}
      </div>
    </div>
  );
}
