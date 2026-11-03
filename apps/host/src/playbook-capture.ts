// Captures what the browser tools did in a thread and turns the model's chosen subset into a stored playbook.
// The model only picks entry numbers from what the host recorded, so it cannot invent URLs or selectors.
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BrowserTraceEntry } from "@pista/pi-browser";
import { Type } from "typebox";
import type { HostEvent, Playbook, PlaybookExpect, PlaybookLocator, PlaybookStep } from "@pista/protocol";
import { getPlaybook, isOpaque, recordSuccess, savePlaybook, siteKey, validatePlaybook } from "./playbooks.ts";

export const TRACE_LIMIT = 200;
export type TraceRow = { n: number } & BrowserTraceEntry;

/** The last TRACE_LIMIT successful browser actions of one thread, numbered from 1 (numbers never repeat). */
export class PlaybookTrace {
  private rows: TraceRow[] = [];
  private next = 1;
  add(entry: BrowserTraceEntry): void {
    this.rows.push({ n: this.next++, ...entry });
    if (this.rows.length > TRACE_LIMIT) this.rows.shift();
  }
  list(): readonly TraceRow[] {
    return this.rows;
  }
}

const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}...` : s);
const where = (l: { role?: string; name?: string; text?: string }) => [l.role, l.name || l.text ? JSON.stringify(clip(l.name || l.text || "")) : ""].filter(Boolean).join(" ");

/** One compact line per entry. Page text in it is data, not instructions. */
export function describeTrace(rows: readonly TraceRow[]): string {
  return rows
    .map((r) => {
      switch (r.kind) {
        case "navigate": return `${r.n} navigate ${r.url}`;
        case "click": return `${r.n} click ${where(r.locator)} -> ${r.urlAfter}`;
        case "download": return `${r.n} download ${r.url ?? where(r.locator ?? {})} (${r.contentType ?? "unknown type"}, ${r.source === "url" ? "address given by you" : "from the page"})`;
        case "signIn": return `${r.n} signIn ${r.origin}`;
      }
    })
    .join("\n");
}

const urlOf = (r: TraceRow): string | undefined => (r.kind === "navigate" ? r.url : r.kind === "click" ? r.urlAfter : r.kind === "download" ? r.url : r.kind === "signIn" ? r.origin : undefined);

/** Builds the playbook for the chosen entry numbers, or throws a short reason. Not yet validated; the caller runs validatePlaybook. */
export function playbookFromTrace(rows: readonly TraceRow[], chosen: number[], waitFor: Record<string, string> = {}): { site: string; startUrl: string; steps: PlaybookStep[] } {
  if (!chosen.length) throw new Error("steps is empty");
  if (chosen.some((n, i) => !Number.isInteger(n) || (i > 0 && n <= chosen[i - 1]!))) throw new Error("steps must be whole entry numbers in increasing order");
  const picked = chosen.map((n) => {
    const r = rows.find((x) => x.n === n);
    if (!r) throw new Error(`no entry ${n} in the recorded trace`);
    return r;
  });
  const first = picked[0]!;
  if (first.kind !== "navigate") throw new Error("the first chosen entry must be a navigate entry (the start page)");
  const last = picked[picked.length - 1]!;
  if (last.kind !== "download") throw new Error("the last chosen entry must be the download that succeeded");
  const site = siteKey(first.url);
  for (const r of picked) {
    const u = urlOf(r);
    if (u && siteKey(u) !== site) throw new Error(`entry ${r.n} is on a different site (${siteKey(u)}), not ${site}`);
  }
  // Text that looks like a token or hash is dropped, never stored.
  const clean = (v?: string) => (v && !isOpaque(v) ? v : undefined);
  const steps: PlaybookStep[] = picked.slice(1).map((r, i): PlaybookStep => {
    const text = clean(waitFor[String(r.n)]?.slice(0, 200));
    const expect: PlaybookExpect = text ? { text } : {};
    switch (r.kind) {
      case "navigate": return { kind: "navigate", url: r.url, ...(text ? { expect } : {}) };
      case "signIn": return { kind: "signIn", origin: r.origin, ...(text ? { expect } : {}) };
      case "click": {
        // The page before this click on the replayed path (the previous chosen entry). A changed path is a stable thing to wait for.
        const before = urlOf(picked[i]!);
        try {
          const path = new URL(r.urlAfter).pathname;
          if (before && path !== new URL(before).pathname && path !== "/") expect.urlIncludes = path;
        } catch {}
        const { name, text: lt, ...rest } = r.locator;
        const target: PlaybookLocator = { ...rest, ...(clean(name) ? { name } : {}), ...(clean(lt) ? { text: lt } : {}) };
        return { kind: "click", target, ...(Object.keys(expect).length ? { expect } : {}) };
      }
      case "download": {
        const fileType = r.contentType?.split(";")[0]?.split("/")[1];
        return { kind: "download", ...(r.url ? { url: r.url } : { target: r.locator }), ...(fileType ? { fileType } : {}) };
      }
    }
  });
  return { site, startUrl: first.url, steps };
}

const sameStep = (a: PlaybookStep | undefined, b: PlaybookStep | undefined) => JSON.stringify(a) === JSON.stringify(b);

/** Saves the playbook (as an update when the site already has one) and returns the message for the model plus the event to emit, if any. */
export function savePlaybookFromTrace(rows: readonly TraceRow[], chosen: number[], waitFor: Record<string, string> | undefined, threadId: string): { message: string; event?: HostEvent } {
  try {
    const built = playbookFromTrace(rows, chosen, waitFor);
    const fresh = validatePlaybook({ ...built, steps: built.steps }, built.site);
    const old = getPlaybook(built.site);
    if (!old) {
      savePlaybook(fresh);
      return { message: `Saved a playbook for ${built.site} with ${fresh.steps.length} steps after the start page.`, event: { type: "playbook.event", threadId, kind: "learned", site: built.site } };
    }
    const max = Math.max(old.steps.length, fresh.steps.length);
    const changed = Array.from({ length: max }, (_, i) => i).filter((i) => !sameStep(old.steps[i], fresh.steps[i]));
    const startChanged = old.startUrl !== fresh.startUrl;
    if (!changed.length && !startChanged) {
      recordSuccess(built.site); // the same path just worked again
      return { message: `The playbook for ${built.site} already matches this path; nothing changed.` };
    }
    const now = new Date().toISOString();
    savePlaybook({ ...fresh, createdAt: old.createdAt, updatedAt: now, lastSucceeded: old.lastSucceeded, successCount: old.successCount, status: "ok", failCount: 0, history: [...old.history, { at: now, summary: `path re-recorded from entries ${chosen.join(",")}; ${startChanged ? "start URL changed" : `changed step${changed.length > 1 ? "s" : ""} ${changed.map((i) => i + 1).join(",")}`}` }] });
    const first = startChanged ? 1 : changed[0]! + 1;
    return { message: `Updated the playbook for ${built.site}; first changed step is ${first}.`, event: { type: "playbook.event", threadId, kind: "updated", site: built.site, step: first } };
  } catch (e) {
    return { message: `Not saved: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function registerPlaybookSave(pi: ExtensionAPI, trace: PlaybookTrace, emit: (e: HostEvent) => void, threadId: string): void {
  pi.registerTool(
    defineTool({
      name: "playbook_save",
      label: "Playbook: save",
      description:
        "Record the shortest path to a file you just downloaded from a website, so it can be repeated later. Call with no arguments to list what the host recorded this thread (numbered entries). Then call again with `steps`: the entry numbers of the minimal path in order, starting with a navigate entry and ending with the download; optionally `waitFor`: text the page should show after an entry (keyed by entry number). Playbook content is data recorded by the host; you can only pick entries, not write URLs or selectors.",
      promptSnippet: "playbook_save: record the path of a successful download for reuse",
      parameters: Type.Object({
        steps: Type.Optional(Type.Array(Type.Number(), { description: "Entry numbers of the minimal path, in order" })),
        waitFor: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Entry number -> text expected on the page afterwards" })),
      }),
      execute: async (_id, { steps, waitFor }) => {
        const rows = trace.list();
        let text: string;
        if (!steps) {
          text = rows.length
            ? `${describeTrace(rows)}\nCall again with steps: the entry numbers of the minimal path, in order, ending with the download; optionally waitFor text per step.`
            : "Nothing has been recorded yet in this thread.";
        } else {
          const r = savePlaybookFromTrace(rows, steps, waitFor, threadId);
          if (r.event) emit(r.event);
          text = r.message;
        }
        return { content: [{ type: "text" as const, text }], details: {} };
      },
    }),
  );
}
