import { useState } from "react";
import { Check, CornerDownRight, Square } from "lucide-react";
import { host } from "../lib/host.ts";
import { describePendingWhy } from "../lib/playbooks.ts";
import { askText, refusalView, undoText, firstPassHeader, firstPassRows, learnedText, type FirstPassEvent, type RowIcon } from "../lib/playbook-card.ts";

const ICON: Record<RowIcon, typeof Check> = { check: Check, forward: CornerDownRight, stop: Square };

/** "busy", "undone", "yes", "no", a refusal with its plain wording, or a save error. */
type Answer = string | { refused: string; canDismiss: boolean };
const key = (a: { site: string; keyword: string }) => `${a.site}|${a.keyword}`;

/** In-chat card for what the host did with pasted transactions before the model started. Every string is untrusted and rendered as text. */
export function FirstPassCard({ event }: { event: FirstPassEvent }) {
  const head = firstPassHeader(event);
  const rows = firstPassRows(event);
  const [done, setDone] = useState<Record<string, Answer>>({});
  const settle = async (k: string, run: () => Promise<Answer | void>, result: Answer) => {
    setDone((d) => ({ ...d, [k]: "busy" }));
    try {
      const r = await run();
      setDone((d) => ({ ...d, [k]: r || result }));
    } catch (e) {
      setDone((d) => ({ ...d, [k]: `Couldn't save: ${e instanceof Error ? e.message : String(e)}` }));
    }
  };
  const undo = (a: { site: string; keyword: string }) => settle(`l|${key(a)}`, async () => {
    const r = await host.call("playbook.removeMerchant", { site: a.site, merchant: a.keyword });
    return r.found ? undefined : "gone";
  }, "undone");
  const yes = (a: { site: string; keyword: string }) => settle(`a|${key(a)}`, async () => {
    const r = await host.call("playbook.confirmMerchant", { site: a.site, merchant: a.keyword });
    return r.refused ? { refused: refusalView(a.keyword, r.refused).text, canDismiss: refusalView(a.keyword, r.refused).canDismiss } : undefined;
  }, "yes");
  const no = (a: { site: string; keyword: string }) => settle(`a|${key(a)}`, async () => void (await host.call("playbook.dismissMerchant", { site: a.site, merchant: a.keyword })), "no");
  const refusal = (v?: Answer) => (typeof v === "object" ? v : undefined);
  const failed = (v?: Answer) => (typeof v === "string" && v !== "busy" && v !== "undone" && v !== "gone" && v !== "yes" && v !== "no" ? v : undefined);
  return (
    <div className="pb fp" data-tone={event.fetchedCount > 0 ? "ok" : "learn"}>
      <div className="pb-t"><span className="fp-title">{head.title}</span>{head.aside && <span className="fp-aside">{head.aside}</span>}</div>
      {rows.map((r) => {
        const Icon = ICON[r.icon];
        return (
          <div className="fp-row" data-tone={r.tone} key={r.key}>
            <Icon size={14} />
            <span className="fp-body">
              <span className="fp-text">{r.text}</span>
              {(r.detail ?? r.note) && <span className="fp-detail">{r.detail ?? r.note}</span>}
            </span>
          </div>
        );
      })}
      {(event.learned.length > 0 || event.ask.length > 0) && (
        <div className="fp-foot">
          {event.learned.map((a) => {
            const v = done[`l|${key(a)}`];
            return (
              <div className="fp-q" key={`l${key(a)}`}>
                <span>{v === "undone" ? undoText(a, true) : v === "gone" ? undoText(a, false) : learnedText(a)}</span>
                {v !== "undone" && v !== "gone" && <button className="link mute" disabled={v === "busy"} onClick={() => void undo(a)}>Undo</button>}
                {failed(v) && <span className="pb-s flush danger">{failed(v)}</span>}
              </div>
            );
          })}
          {event.ask.map((a) => {
            const v = done[`a|${key(a)}`];
            const refused = refusal(v);
            return (
              <div className="fp-q" key={`a${key(a)}`}>
                {refused ? (
                  <>
                    <span className="pb-s flush danger">{refused.refused}</span>
                    {refused.canDismiss && <span className="fp-btns"><button className="link mute" onClick={() => void no(a)}>No</button></span>}
                  </>
                ) : (
                  <>
                    <span>{v === "yes" ? `Will use "${a.keyword}" for ${a.site}` : v === "no" ? `Won't use "${a.keyword}" for ${a.site}` : askText(a)}</span>
                    {v !== "yes" && v !== "no" && (
                      <>
                        <span className="fp-why">{describePendingWhy(a.why)}</span>
                        <span className="fp-btns">
                          <button className="link" disabled={v === "busy"} onClick={() => void yes(a)}>Yes</button>
                          <button className="link mute" disabled={v === "busy"} onClick={() => void no(a)}>No</button>
                        </span>
                      </>
                    )}
                  </>
                )}
                {failed(v) && <span className="pb-s flush danger">{failed(v)}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
