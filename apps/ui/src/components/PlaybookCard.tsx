import { useState } from "react";
import { Check, ChevronRight, CircleAlert, Pencil, Route, TriangleAlert } from "lucide-react";
import type { Playbook } from "@pista/protocol";
import { host } from "../lib/host.ts";
import { playbookCardText } from "../lib/playbook-card.ts";
import { useApp, type PlaybookCardEvent } from "../lib/store.ts";

const ICON = { followed: Check, repairing: TriangleAlert, updated: Pencil, learned: Route, "needs-attention": CircleAlert } as const;

function stepLabel(s: Playbook["steps"][number]): string {
  switch (s.kind) {
    case "navigate": return `Open ${s.url}`;
    case "click": return `Click ${s.target.name ?? s.target.text ?? s.target.selector ?? "element"}`;
    case "signIn": return `Sign in with saved login (${s.origin})`;
    case "wait": return "Wait for the page";
    case "download": return "Download the file";
  }
}

/** In-chat card for one playbook event. Every string is untrusted and rendered as text. */
export function PlaybookCard({ event }: { event: PlaybookCardEvent }) {
  const t = playbookCardText(event);
  const Icon = ICON[event.kind];
  const [steps, setSteps] = useState<string[] | null | "loading">(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [gone, setGone] = useState(false);
  // Settings has no Playbooks section yet: open it on its first tab.
  const openSettings = () => useApp.setState({ settingsOpen: "general" });
  const toggle = async () => {
    setOpen(!open);
    if (steps !== null) return;
    setSteps("loading");
    try {
      const pb = await host.call("playbook.get", { site: event.site });
      setSteps(pb ? pb.steps.map(stepLabel) : []);
    } catch {
      setSteps([]);
    }
  };
  const forget = async () => {
    try {
      await host.call("playbook.delete", { site: event.site });
      setGone(true);
    } catch {
      setConfirm(false);
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
          {event.kind === "learned" && <button className="link" onClick={openSettings}>View</button>}
          {event.kind === "needs-attention" && <button className="link" onClick={openSettings}>Review playbook</button>}
          {event.kind === "learned" && (confirm ? (
            <>
              <span className="pb-s" style={{ padding: 0 }}>Forget this playbook?</span>
              <button className="link danger" onClick={() => void forget()}>Forget</button>
              <button className="link mute" onClick={() => setConfirm(false)}>Cancel</button>
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
