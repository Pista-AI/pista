import type { HostEvent } from "@pista/protocol";

type PlaybookEvent = Omit<Extract<HostEvent, { type: "playbook.event" }>, "type">;
export type CardTone = "ok" | "learn" | "warn" | "bad";

export interface CardText {
  tone: CardTone;
  title: string;
  /** Sub-lines, each plain text. */
  lines: string[];
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function money(i: NonNullable<PlaybookEvent["invoice"]>): string {
  if (i.amount === undefined) return "";
  return ` · ${i.currency ? `${i.amount} ${i.currency}` : String(i.amount)}`;
}

/** Title and sub-lines for one playbook event. All inputs are untrusted display text. */
export function playbookCardText(e: PlaybookEvent): CardText {
  const step = e.step !== undefined ? `step ${e.step}` : "a step";
  switch (e.kind) {
    case "followed": {
      const parts = [e.stepCount !== undefined ? plural(e.stepCount, "step") : "", e.invoice ? `invoice ${e.invoice.date}${money(e.invoice)}` : "", "1 download"].filter(Boolean);
      return { tone: "ok", title: `Followed playbook for ${e.site}`, lines: [parts.join(" · ")] };
    }
    case "repairing":
      return {
        tone: "warn",
        title: `Playbook ${step} failed — the assistant is repairing it`,
        lines: [[e.step !== undefined ? `Step ${e.step}` : "", e.reason ?? ""].filter(Boolean).join(" · "), e.invoice ? `Looking for invoice ${e.invoice.date}` : ""].filter(Boolean),
      };
    case "updated":
      return { tone: "ok", title: `Updated playbook for ${e.site}${e.step !== undefined ? ` (step ${e.step} changed)` : ""}`, lines: [] };
    case "learned":
      return { tone: "learn", title: `Learned a playbook for ${e.site}`, lines: [`${e.stepCount !== undefined ? plural(e.stepCount, "step") + " saved" : "Saved"} · used next time`] };
    case "needs-attention":
      return { tone: "bad", title: `Playbook for ${e.site} needs attention`, lines: e.reason ? [e.reason] : e.step !== undefined ? [`Step ${e.step} keeps failing`] : [] };
  }
}
