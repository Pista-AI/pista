import { useState } from "react";
import { useApp } from "../lib/store.ts";
import { host } from "../lib/host.ts";

/** Answers prompts raised by a provider login flow (e.g. paste a redirect URL or pick an option). */
export function AuthPromptDialog() {
  const pending = useApp((s) => s.authPrompt);
  const [value, setValue] = useState("");
  if (!pending) return null;
  const { prompt } = pending;
  const respond = (v: string | null) => {
    void host.call("auth.promptResponse", { promptId: pending.promptId, value: v });
    useApp.setState({ authPrompt: undefined });
    setValue("");
  };
  const options = Array.isArray((prompt as { options?: unknown }).options)
    ? (prompt as { options: { id: string; label: string; description?: string }[] }).options
    : null;

  return (
    <div className="overlay">
      <div className="modal small">
        <h3 style={{ margin: 0 }}>Sign in to {pending.provider}</h3>
        <div style={{ color: "var(--text-2)" }}>{String(prompt.message ?? "")}</div>
        {options ? (
          options.map((o) => (
            <button key={o.id} className="menu-item" style={{ border: "1px solid var(--border)" }} onClick={() => respond(o.id)}>
              <span>
                <div>{o.label}</div>
                {o.description && <div className="desc">{o.description}</div>}
              </span>
            </button>
          ))
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              respond(value);
            }}
          >
            <input
              className="search"
              autoFocus
              type={prompt.type === "secret" ? "password" : "text"}
              placeholder={String((prompt as { placeholder?: string }).placeholder ?? "")}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </form>
        )}
        <div className="btn-row">
          <button className="pill-btn" onClick={() => respond(null)}>
            Cancel
          </button>
          {!options && (
            <button className="pill-btn primary" onClick={() => respond(value)}>
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
