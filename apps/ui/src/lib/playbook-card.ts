import type { HostEvent } from "@pista/protocol";
import type { PlaybookCardEvent } from "./store.ts";
import { describeRefusal, runWhy } from "./playbooks.ts";
import type { MerchantRefusal } from "@pista/protocol";

type PlaybookEvent = PlaybookCardEvent;
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
        lines: [[e.step !== undefined ? `Step ${e.step}` : "", e.reason ?? ""].filter(Boolean).join(" · "), e.invoice ? `Looking for invoice ${e.invoice.date}${money(e.invoice)}` : ""].filter(Boolean),
      };
    case "updated":
      return { tone: "ok", title: `Updated playbook for ${e.site}${e.step !== undefined ? ` (step ${e.step} changed)` : ""}`, lines: e.before && e.after ? [`${e.before} → ${e.after}`] : [] };
    case "learned":
      return { tone: "learn", title: `Learned a playbook for ${e.site}`, lines: [`${e.stepCount !== undefined ? plural(e.stepCount, "step") + " saved" : "Saved"} · used next time`] };
    case "needs-attention":
      return { tone: "bad", title: `Playbook for ${e.site} needs attention`, lines: e.reason ? [e.reason] : e.step !== undefined ? [`Step ${e.step} keeps failing`] : [] };
  }
}

export type FirstPassEvent = Omit<Extract<HostEvent, { type: "playbook.firstPass" }>, "type">;
type FirstPassLine = FirstPassEvent["lines"][number];
export type RowIcon = "check" | "forward" | "stop";
export interface FirstPassRow { key: string; icon: RowIcon; tone: "ok" | "muted" | "warn"; text: string; /** a file name or short note */ detail?: string; note?: string }

/** "Line 2", "Lines 5–6", or "Lines 2, 5–6, 9": runs of consecutive numbers use the range form. */
export function lineWord(nos: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < nos.length; ) {
    let j = i;
    while (j + 1 < nos.length && nos[j + 1] === nos[j]! + 1) j++;
    parts.push(j > i ? `${nos[i]}–${nos[j]}` : String(nos[i]));
    i = j + 1;
  }
  return `${nos.length === 1 ? "Line" : "Lines"} ${parts.join(", ")}`;
}

function facts(l: FirstPassLine): string[] {
  return [l.site, l.date, l.amount !== undefined ? (l.currency ? `${l.amount} ${l.currency}` : String(l.amount)) : undefined].filter((x): x is string => !!x);
}

/** One row per fetched line, one per run of neighbouring lines handed on the same way, and one last row for every unmatched line. */
export function firstPassRows(e: FirstPassEvent): FirstPassRow[] {
  const rows: FirstPassRow[] = [];
  let group: { first: FirstPassLine; nos: number[]; sig: string } | undefined;
  const flush = () => {
    if (!group) return;
    const { first, nos } = group;
    const head = lineWord(nos);
    const who = first.site ?? "no known site";
    if (first.status === "handed-off") rows.push({ key: `h${first.lineNo}`, icon: "forward", tone: "warn", text: `${head} · ${who} · ${runWhy(first.reason)}`, note: "passed to the model" });
    else if (first.status === "declined") rows.push({ key: `d${first.lineNo}`, icon: "stop", tone: "warn", text: `${head} · ${who} · you declined — ask before fetching` });
    else rows.push({ key: `s${first.lineNo}`, icon: "stop", tone: "warn", text: `${head} · ${who} · stopped before it ran` });
    group = undefined;
  };
  const unmatched: FirstPassLine[] = [];
  for (const l of e.lines) {
    if (l.status === "fetched" || l.status === "exists") {
      flush();
      rows.push({ key: `f${l.lineNo}`, icon: "check", tone: "ok", text: `Line ${l.lineNo} · ${facts(l).join(" · ")}`, detail: l.status === "exists" ? "already saved" : l.file });
      continue;
    }
    if (l.status === "unmatched") {
      unmatched.push(l);
      continue;
    }
    const sig = [l.status, l.site, l.reason].join("|");
    if (group && group.sig === sig && l.lineNo === group.nos[group.nos.length - 1]! + 1) group.nos.push(l.lineNo);
    else {
      flush();
      group = { first: l, nos: [l.lineNo], sig };
    }
  }
  flush();
  if (unmatched.length) {
    unmatched.sort((x, y) => x.lineNo - y.lineNo);
    const reasons = new Set(unmatched.map((l) => l.reason));
    const reason = reasons.size === 1 ? unmatched[0]!.reason : undefined;
    rows.push({ key: `u${unmatched[0]!.lineNo}`, icon: "forward", tone: "muted", text: `${lineWord(unmatched.map((l) => l.lineNo))} · no known site${reason ? ` · ${reason}` : ""}`, note: "passed to the model" });
  }
  return rows;
}

/** The header; "no model used" only when the host really fetched something. */
export function firstPassHeader(e: FirstPassEvent): { title: string; aside?: string } {
  if (e.fetchedCount > 0) return { title: `Fetched ${e.fetchedCount} of ${e.total} invoices from known sites`, aside: "no model used" };
  return { title: e.lines.some((l) => l.status === "declined") ? "Known sites: not fetched" : "Checked the pasted lines against known sites" };
}

export const askText = (a: { site: string; keyword: string }): string => `Use "${a.keyword}" for ${a.site} next time?`;
export const learnedText = (a: { site: string; keyword: string }): string => `Learned "${a.keyword}" for ${a.site}`;

/** What the card shows after Yes was refused: the wording, and whether No (dismiss) still makes sense. A keyword that is no longer pending has nothing left to dismiss. */
export const refusalView = (keyword: string, reason: MerchantRefusal): { text: string; canDismiss: boolean } => ({ text: describeRefusal(keyword, reason), canDismiss: reason !== "not-pending" });

/** The note after Undo: removeMerchant says `found: false` when the keyword was already gone. */
export const undoText = (a: { site: string; keyword: string }, found: boolean): string => (found ? `Forgot "${a.keyword}" for ${a.site}` : "Already removed");
