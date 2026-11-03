import { useState } from "react";
import { Check, ChevronRight, CircleAlert, Pencil, Route, TriangleAlert } from "lucide-react";
import { host } from "../lib/host.ts";
import { playbookCardText } from "../lib/playbook-card.ts";
import { describeSteps } from "../lib/playbooks.ts";
import type { PlaybookCardEvent } from "../lib/store.ts";
import { openPlaybooksSettings } from "./Playbooks.tsx";

const ICON = { followed: Check, repairing: TriangleAlert, updated: Pencil, learned: Route, "needs-attention": CircleAlert } as const;

/** In-chat card for one playbook event. Every string is untrusted and rendered as text. */
export function PlaybookCard({ event }: { event: PlaybookCardEvent }) {
  const t = playbookCardText(event);
  const Icon = ICON[event.kind];
  const [steps, setSteps] = useState<string[] | null | "loading">(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async () => {
    setOpen(!open);
    if (steps !== null) return;
    setSteps("loading");
    try {
      const pb = await host.call("playbook.get", { site: event.site });
      setSteps(pb ? describeSteps(pb.steps) : []);
    } catch {
      setSteps([]);
    }
  };
  const forget = async () => {
    try {
      await host.call("playbook.delete", { site: event.site });
      setGone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="pb" data-tone={t.tone}>
      <div className="pb-t"><Icon size={16} />{t.title}</div>
      {t.lines.map((l, i) => <div className="pb-s" key={i}>{l}</div>)}
      {event.kind === "updated" && event.before && event.after && (
        <div className="pb-diff"><div className="del">{event.before}</div><div className="add">{event.after}</div></div>
      )}
      {gone ? <div className="pb-s">Playbook forgotten.</div> : (
        <div className="pb-row">
          {event.kind === "followed" && <button className="link mute" onClick={() => void toggle()}><ChevronRight size={12} className={open ? "pb-chev open" : "pb-chev"} /> View steps</button>}
          {event.kind === "learned" && <button className="link" onClick={openPlaybooksSettings}>View</button>}
          {event.kind === "needs-attention" && <button className="link" onClick={openPlaybooksSettings}>Review playbook</button>}
          {event.kind === "learned" && (confirm ? (
            <>
              <span className="pb-s" style={{ padding: 0 }}>Forget this playbook?</span>
              <button className="link danger" onClick={() => void forget()}>Forget</button>
              <button className="link mute" onClick={() => { setConfirm(false); setError(null); }}>Cancel</button>
              {error && <span className="pb-s" style={{ padding: 0, color: "var(--red)" }}>Couldn't forget: {error}</span>}
            </>
          ) : <button className="link mute" onClick={() => setConfirm(true)}>Forget</button>)}
        </div>
      )}
      {open && event.kind === "followed" && (
        <ol className="pb-steps">
          {steps === "loading" ? <li>Loading…</li> : steps?.length ? steps.map((s, i) => <li key={i}>{s}</li>) : <li>No steps available.</li>}
        </ol>
      )}
    </div>
  );
}
