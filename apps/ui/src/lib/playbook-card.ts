import type { HostEvent } from "@pista/protocol";
import type { PlaybookCardEvent } from "./store.ts";

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
type AskWhy = FirstPassEvent["ask"][number]["why"];

/** Plain words for why a keyword needs the user's say. */
export const ASK_WHY: Record<AskWhy, string> = {
  short: "it is a short word that could match other shops",
  umbrella: "it is a big brand with many services",
  "other-site": "another site already uses it",
  unsure: "it may not be specific enough",
};
/** Plain words for why a saved site's run stopped. */
const RUN_WHY: Record<string, string> = {
  "not-found": "could not find the download button",
  ambiguous: "found more than one match",
  "expectation-timeout": "the page did not load in time",
  blocked: "the site is not allowed",
  declined: "you declined",
  aborted: "stopped",
  "sign-in-needed": "needs you to sign in",
  "row-not-found": "did not find that invoice in the list",
  "row-ambiguous": "found more than one matching invoice",
  "row-not-verified": "found an invoice but could not confirm it is the right one",
  "needs-invoice": "needs the invoice date",
  error: "something went wrong",
};
export const runWhy = (r?: string): string => (r ? (RUN_WHY[r] ?? "could not finish") : "could not finish");

export type RowIcon = "check" | "forward" | "stop";
export interface FirstPassRow { key: string; icon: RowIcon; tone: "ok" | "muted" | "warn"; text: string; /** a file name or short note */ detail?: string; note?: string }

const lineWord = (a: number, b: number) => (a === b ? `Line ${a}` : `Lines ${a}–${b}`);

function facts(l: FirstPassLine): string[] {
  return [l.site, l.date, l.amount !== undefined ? (l.currency ? `${l.amount} ${l.currency}` : String(l.amount)) : undefined].filter((x): x is string => !!x);
}

/** One row per fetched line, one per run of neighbouring lines that were passed on the same way. */
export function firstPassRows(e: FirstPassEvent): FirstPassRow[] {
  const rows: FirstPassRow[] = [];
  let group: { first: FirstPassLine; end: number; sig: string } | undefined;
  const flush = () => {
    if (!group) return;
    const { first, end } = group;
    const head = lineWord(first.lineNo, end);
    const who = first.site ?? "no known site";
    if (first.status === "unmatched") rows.push({ key: `u${first.lineNo}`, icon: "forward", tone: "muted", text: `${head} · ${who}${first.reason ? ` · ${first.reason}` : ""}`, note: "passed to the model" });
    else if (first.status === "handed-off") rows.push({ key: `h${first.lineNo}`, icon: "forward", tone: "warn", text: `${head} · ${who} · ${runWhy(first.reason)}`, note: "passed to the model" });
    else if (first.status === "declined") rows.push({ key: `d${first.lineNo}`, icon: "stop", tone: "warn", text: `${head} · ${who} · you declined — ask before fetching` });
    else rows.push({ key: `s${first.lineNo}`, icon: "stop", tone: "warn", text: `${head} · ${who} · stopped before it ran` });
    group = undefined;
  };
  for (const l of e.lines) {
    if (l.status === "fetched" || l.status === "exists") {
      flush();
      rows.push({ key: `f${l.lineNo}`, icon: "check", tone: "ok", text: `Line ${l.lineNo} · ${facts(l).join(" · ")}`, detail: l.status === "exists" ? "already saved" : l.file });
      continue;
    }
    const sig = [l.status, l.site, l.reason].join("|");
    if (group && group.sig === sig && l.lineNo === group.end + 1) group.end = l.lineNo;
    else {
      flush();
      group = { first: l, end: l.lineNo, sig };
    }
  }
  flush();
  return rows;
}

/** The header; "no model used" only when the host really fetched something. */
export function firstPassHeader(e: FirstPassEvent): { title: string; aside?: string } {
  if (e.fetchedCount > 0) return { title: `Fetched ${e.fetchedCount} of ${e.total} invoices from known sites`, aside: "no model used" };
  return { title: e.lines.some((l) => l.status === "declined") ? "Known sites: not fetched" : "Checked the pasted lines against known sites" };
}

export const askText = (a: { site: string; keyword: string }): string => `Use "${a.keyword}" for ${a.site} next time?`;
export const learnedText = (a: { site: string; keyword: string }): string => `Learned "${a.keyword}" for ${a.site}`;
