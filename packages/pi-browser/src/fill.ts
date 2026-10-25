/**
 * browser_fill: several fields in one call (on by default, PI_BROWSER_FILL=0 turns it off). Each field goes through the same page actions as the
 * single-field tools (type, select, click), so every safety stop runs per field and for the submit: secret fields are refused with
 * browser_type's hand-back, a held click asks the user. After each field the control is read back and one line is recorded;
 * the first field that fails ends the batch and nothing is submitted. One snapshot is taken at the end, not per field.
 *
 * Refs are stable only while no snapshot is taken (a snapshot renumbers them; with delta results on (the default) they are stable per document
 * anyway, but a snapshot per field would still be wasted work and would move the delta baseline), so the page actions run against a
 * driver whose snapshot is a stub (matched by script text, for both settings of the delta flag), and every field is re-checked
 * against what its ref named when the call started. With PI_BROWSER_CHOOSE=1 a combobox is filled by browser_choose's logic.
 */
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runPageAction, type Approve, type PageAction } from "./actions.ts";
import type { RiskApprover } from "./approval.ts";
import { chooseEnabled, runChoose, type ChooseResult } from "./choose.ts";
import { deltaEnabled, presentSnapshot } from "./delta.ts";
import type { BrowserDriver, PageState } from "./driver.ts";
import { formatSnapshot, jsLiteral, scripts, type PageSnapshot } from "./page-scripts.ts";

/** Registered unless PI_BROWSER_FILL=0. Read at call time so a test can switch it. */
export const fillEnabled = (): boolean => process.env.PI_BROWSER_FILL !== "0";

export interface FillField {
  ref: string;
  value: string;
}

/** A suggestion list gets this long to show a matching option after typing into a combobox. */
export const SUGGESTION_WAIT_MS = 1000;
const SUGGESTION_POLL_MS = 100;
/** Fields per call, and the longest value shown back in a result line. */
export const MAX_FIELDS = 30;
const SHOWN = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Page scripts (serialized into Runtime.evaluate, so self-contained) ----

type FillKind = "text" | "select" | "checkbox" | "radio" | "combobox" | "other";
interface FillProbe {
  error?: string;
  kind: FillKind;
  label: string;
  checked?: boolean;
  /** Only with readValue: the field's text, or the selected option's text for a dropdown. Never asked for before the secret check passed. */
  value?: string;
  selectedValue?: string;
}

/** What the control behind `target` (a ref or CSS selector) is and, with `readValue`, what it holds now. */
function pageFillProbe(target: string, readValue: boolean): FillProbe {
  const w = window as unknown as { __pistaRefs?: Map<string, WeakRef<Element>> };
  let el: Element | null | undefined;
  try {
    el = /^e\d+$/.test(target) ? w.__pistaRefs?.get(target)?.deref() : document.querySelector(target);
  } catch {
    el = null;
  }
  if (!el || !el.isConnected) return { error: `Ref ${target} is not on the page (anymore). Take a new browser_snapshot and use its refs.`, kind: "other", label: target };
  const html = el as HTMLElement;
  const input = el as HTMLInputElement;
  const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const labelledBy = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => (id ? (document.getElementById(id)?.textContent ?? "") : "")).join(" ");
  const labels = input.labels && input.labels.length ? [...input.labels].map((l) => l.textContent ?? "").join(" ") : "";
  const label = squash(el.getAttribute("aria-label") || squash(labelledBy) || labels || el.getAttribute("placeholder") || el.getAttribute("name") || el.id || html.innerText || el.tagName.toLowerCase()).slice(0, 40);
  const role = el.getAttribute("role");
  const type = el.tagName === "INPUT" ? input.type : "";
  let kind: FillKind = "other";
  if (el.tagName === "SELECT") kind = "select";
  else if (type === "checkbox" || role === "checkbox" || role === "switch") kind = "checkbox";
  else if (type === "radio" || role === "radio") kind = "radio";
  else if (el.tagName === "TEXTAREA" || html.isContentEditable || (el.tagName === "INPUT" && !["button", "submit", "reset", "image", "file", "range", "hidden"].includes(type)) || role === "textbox" || role === "searchbox")
    kind = (role === "combobox" || (el.getAttribute("aria-autocomplete") ?? "none") === "list" || el.getAttribute("aria-autocomplete") === "both") && el.tagName === "INPUT" ? "combobox" : "text";
  else if (role === "combobox") kind = "combobox";
  const out: FillProbe = { kind, label };
  if (kind === "checkbox" || kind === "radio") out.checked = el.tagName === "INPUT" ? input.checked : el.getAttribute("aria-checked") === "true";
  if (readValue) {
    if (kind === "select") {
      const chosen = (el as HTMLSelectElement).selectedOptions[0];
      out.value = squash(chosen?.text);
      out.selectedValue = chosen?.value ?? "";
    } else if (kind === "text" || kind === "combobox") out.value = el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? input.value : squash(html.innerText);
  }
  return out;
}

const PICK_ATTR = "data-pista-fill-pick";

/** Marks the member of `target`'s radio group whose label or value matches `want`, so it can be clicked by selector. Returns its label, or null. */
function pageFillMarkRadio(target: string, want: string, attr: string): { label: string; options: string[] } | null {
  const w = window as unknown as { __pistaRefs?: Map<string, WeakRef<Element>> };
  const el = (/^e\d+$/.test(target) ? w.__pistaRefs?.get(target)?.deref() : document.querySelector(target)) as HTMLInputElement | null | undefined;
  if (!el) return null;
  const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const group: Element[] = el.tagName === "INPUT" && el.name ? [...(el.form ?? document).querySelectorAll(`input[type=radio]`)].filter((r) => (r as HTMLInputElement).name === el.name) : [el];
  const labelOf = (r: Element) => squash((r as HTMLInputElement).labels?.length ? [...(r as HTMLInputElement).labels!].map((l) => l.textContent ?? "").join(" ") : r.getAttribute("aria-label"));
  const w0 = squash(want).toLowerCase();
  const match = group.find((r) => labelOf(r).toLowerCase() === w0 || ((r as HTMLInputElement).value ?? "").toLowerCase() === w0) ?? group.find((r) => w0 && labelOf(r).toLowerCase().includes(w0));
  document.querySelectorAll(`[${attr}]`).forEach((e) => e.removeAttribute(attr));
  if (!match) return { label: "", options: group.map(labelOf).filter(Boolean) };
  match.setAttribute(attr, "1");
  return { label: labelOf(match), options: [] };
}

/** Marks the visible suggestion that best matches `want` (exact, then prefix, then contains), preferring the combobox's own list. Returns its label and what was offered. */
function pageFillMarkOption(target: string, want: string, attr: string): { label: string; offered: string[]; count: number } {
  const w = window as unknown as { __pistaRefs?: Map<string, WeakRef<Element>> };
  const el = /^e\d+$/.test(target) ? w.__pistaRefs?.get(target)?.deref() : document.querySelector(target);
  const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  document.querySelectorAll(`[${attr}]`).forEach((e) => e.removeAttribute(attr));
  const visible = (o: Element) => {
    const r = o.getBoundingClientRect();
    const check = (o as HTMLElement & { checkVisibility?: (x: object) => boolean }).checkVisibility;
    return r.width >= 1 && r.height >= 1 && (!check || check.call(o, { visibilityProperty: true }));
  };
  const own = (el?.getAttribute("aria-controls") ?? el?.getAttribute("aria-owns") ?? "").split(/\s+/).map((id) => (id ? document.getElementById(id) : null)).filter((e): e is HTMLElement => !!e);
  const scoped = own.flatMap((l) => [...l.querySelectorAll("[role=option]")]).filter(visible);
  const options = scoped.length ? scoped : [...document.querySelectorAll("[role=option]")].filter(visible);
  const labels = options.map((o) => squash((o as HTMLElement).innerText || o.textContent));
  const want0 = squash(want).toLowerCase();
  let i = labels.findIndex((l) => l.toLowerCase() === want0);
  if (i < 0) i = labels.findIndex((l) => want0 !== "" && l.toLowerCase().startsWith(want0));
  if (i < 0) i = labels.findIndex((l) => want0 !== "" && l.toLowerCase().includes(want0));
  const offered = labels.slice(0, 5).map((l) => l.slice(0, 40));
  if (i < 0) return { label: "", offered, count: labels.length };
  options[i]!.setAttribute(attr, "1");
  return { label: labels[i]!, offered, count: labels.length };
}

// Same wrapper as page-scripts.ts: tsx/esbuild wraps nested functions in __name(), which the page does not have.
export const inPage = (fn: (...args: never[]) => unknown, ...args: unknown[]) =>
  `(() => { const __name = (f) => f; return (${fn.toString()})(${args.map(jsLiteral).join(", ")}); })()`;

const probeScript = (target: string, readValue = false) => inPage(pageFillProbe, target, readValue);
const markRadioScript = (target: string, want: string) => inPage(pageFillMarkRadio, target, want, PICK_ATTR);
const markOptionScript = (target: string, want: string) => inPage(pageFillMarkOption, target, want, PICK_ATTR);
const unmarkScript = () => `document.querySelectorAll("[${PICK_ATTR}]").forEach((e) => e.removeAttribute("${PICK_ATTR}"))`;
const PICKED = `[${PICK_ATTR}]`;

// ---- Per-field logic ----

const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const show = (s: string) => JSON.stringify(s.length > SHOWN ? `${s.slice(0, SHOWN)}…` : s);
const TRUE = new Set(["true", "yes", "on", "checked", "1"]);
const FALSE = new Set(["false", "no", "off", "unchecked", "0"]);

interface FieldOutcome {
  ok: boolean;
  line: string;
  /** Text for the result's note: a stop or a hand-back the model must relay to the user. */
  note?: string;
}

/** What one field needs from the page actions: run an action (stops and approval included) and read the control. */
interface FieldIo {
  act(req: PageAction): ReturnType<typeof runPageAction>;
  probe(target: string, readValue?: boolean): Promise<FillProbe>;
  eval(script: string): Promise<unknown>;
  /** browser_choose's logic (PI_BROWSER_CHOOSE=1), on the same snapshot-less driver; undefined when that flag is off. */
  choose?(ref: string, text: string): Promise<ChooseResult>;
}

const failed = (label: string, what: string, note?: string): FieldOutcome => ({ ok: false, line: `${label}: ${what} ✗`, note });
const firstSentence = (s: string) => (s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s).slice(0, 160);

/** Types `text` into a text-like control and reads it back. A secret field is refused by the type action itself; the value is never echoed. */
async function fillText(io: FieldIo, ref: string, label: string, text: string): Promise<FieldOutcome> {
  const res = await io.act({ action: "type", target: ref, text });
  if (res.note) return failed(label, /^Not typed:/.test(res.note) ? "secret field, not typed (the user types it in the pane)" : firstSentence(res.note), res.note);
  const now = (await io.probe(ref, true)).value ?? "";
  return norm(now) === norm(text) ? { ok: true, line: `${label} = ${show(now)} ✓` } : failed(label, `typed ${show(text)} but the field shows ${show(now)}`);
}

/** Combobox with a suggestion list: type, then pick the best-matching option if one shows up within SUGGESTION_WAIT_MS. Kept apart so a fuller browser_choose can replace it. */
export async function fillCombobox(io: FieldIo, ref: string, label: string, text: string): Promise<FieldOutcome> {
  if (io.choose) return fillComboboxChoose(io, io.choose, ref, label, text);
  const typed = await io.act({ action: "type", target: ref, text });
  if (typed.note) return failed(label, /^Not typed:/.test(typed.note) ? "secret field, not typed (the user types it in the pane)" : firstSentence(typed.note), typed.note);
  let marked = (await io.eval(markOptionScript(ref, text))) as { label: string; offered: string[]; count: number };
  for (let waited = 0; !marked.label && waited < SUGGESTION_WAIT_MS; waited += SUGGESTION_POLL_MS) {
    await sleep(SUGGESTION_POLL_MS);
    marked = (await io.eval(markOptionScript(ref, text))) as typeof marked;
  }
  if (!marked.label) {
    await io.eval(unmarkScript());
    const offered = marked.offered.length ? ` (offered: ${marked.offered.join(" | ")})` : " (no suggestions appeared)";
    return failed(label, `typed ${show(text)}, suggestion not chosen${offered}`);
  }
  const clicked = await io.act({ action: "click", target: PICKED });
  await io.eval(unmarkScript());
  if (clicked.note) return failed(label, `suggestion ${show(marked.label)} not clicked: ${firstSentence(clicked.note)}`, clicked.note);
  const now = (await io.probe(ref, true)).value ?? "";
  const ok = norm(now) !== "" && (norm(now) === norm(marked.label) || norm(now).includes(norm(text)) || norm(marked.label).includes(norm(now)));
  return ok ? { ok, line: `${label} = ${show(now)} ✓` } : failed(label, `picked ${show(marked.label)} but the field shows ${show(now)}`);
}

/** PI_BROWSER_CHOOSE=1: the combobox goes through browser_choose (clear, type, wait for a settled list, best match, click, verify committed). */
async function fillComboboxChoose(io: FieldIo, choose: (ref: string, text: string) => Promise<ChooseResult>, ref: string, label: string, text: string): Promise<FieldOutcome> {
  const res = await choose(ref, text);
  if (res.note) return failed(label, firstSentence(res.note), res.note);
  if (!res.ok) return failed(label, (res.outcome ?? "not chosen").replace(/\s+/g, " ").slice(0, 240));
  const now = (await io.probe(ref, true)).value ?? "";
  return { ok: true, line: `${label} = ${show(now)} ✓` };
}

async function fillSelect(io: FieldIo, ref: string, label: string, option: string): Promise<FieldOutcome> {
  const res = await io.act({ action: "select", target: ref, option });
  if (res.note) return failed(label, firstSentence(res.note), res.note);
  const now = await io.probe(ref, true);
  const ok = norm(now.value).includes(norm(option)) || norm(now.selectedValue) === norm(option);
  return ok ? { ok, line: `${label} = ${show(now.value ?? "")} ✓` } : failed(label, `asked for ${show(option)} but ${show(now.value ?? "")} is selected`);
}

/** Checkbox or radio: value "true"/"false" (also yes/no/on/off) or its label. A radio can only be checked; a value naming another label in its group checks that one. */
async function fillToggle(io: FieldIo, ref: string, label: string, probe: FillProbe, value: string): Promise<FieldOutcome> {
  const v = norm(value);
  const radio = probe.kind === "radio";
  const labelMatch = v !== "" && (norm(label) === v || norm(label).includes(v) || v.includes(norm(label)));
  // On a radio only "true"/"false" are states; "yes"/"no" are more likely the labels of a Yes/No pair.
  const isTrue = radio ? v === "true" : TRUE.has(v);
  const isFalse = radio ? v === "false" : FALSE.has(v);
  const want = isTrue || (labelMatch && !isFalse) ? true : isFalse ? false : undefined;
  if (want === undefined) {
    if (!radio) return failed(label, `value ${show(value)} is neither true/false nor this checkbox's label`);
    const group = (await io.eval(markRadioScript(ref, value))) as { label: string; options: string[] } | null;
    if (!group?.label) {
      await io.eval(unmarkScript());
      return failed(label, `no radio option ${show(value)}${group?.options.length ? ` (options: ${group.options.join(" | ")})` : ""}`);
    }
    const res = await io.act({ action: "click", target: PICKED });
    const now = await io.probe(PICKED);
    await io.eval(unmarkScript());
    if (res.note) return failed(label, firstSentence(res.note), res.note);
    return now.checked ? { ok: true, line: `${label} = ${show(group.label)} ✓` } : failed(label, `clicked ${show(group.label)} but it is not selected`);
  }
  if (radio && !want) return failed(label, "a radio button cannot be unchecked; choose another option of its group instead");
  if (probe.checked !== want) {
    const res = await io.act({ action: "click", target: ref });
    if (res.note) return failed(label, firstSentence(res.note), res.note);
  }
  const now = (await io.probe(ref)).checked;
  const state = now ? "checked" : "unchecked";
  return now === want ? { ok: true, line: `${label} = ${state} ✓` } : failed(label, `wanted ${want ? "checked" : "unchecked"} but it is ${state}`);
}

// ---- The tool ----

export interface FillDeps {
  driver: () => BrowserDriver | Promise<BrowserDriver>;
  askApproval?: RiskApprover;
}

export interface FillResult {
  outcome: string;
  text?: string;
  note?: string;
}

const EMPTY_SNAPSHOT: PageSnapshot = { lines: [], count: 0, omitted: 0, scroll: { y: 0, height: 0, viewport: 0 }, elements: [] } as unknown as PageSnapshot;
/** The snapshot scripts the page actions run: refs renumbered (PI_BROWSER_DELTA=0) or stable (the default). Both are stubbed. */
const SNAPSHOT_SCRIPTS: ReadonlySet<string> = new Set([scripts.snapshot(150), scripts.snapshot(150, false, true)]);

/** The driver with page snapshots stubbed out: per-field actions would otherwise renumber the refs of the fields still to come. */
function withoutSnapshots(d: BrowserDriver): BrowserDriver {
  return {
    navigate: (url) => d.navigate(url),
    state: () => d.state(),
    back: () => d.back(),
    reload: () => d.reload(),
    evaluate: (script) => (SNAPSHOT_SCRIPTS.has(script) ? Promise.resolve(EMPTY_SNAPSHOT) : d.evaluate(script)),
    input: (e) => d.input(e),
    screenshot: () => d.screenshot(),
    setActivity: (label) => d.setActivity?.(label),
  };
}

const where = (s: PageState) => `${s.url.slice(0, 160)}${s.title ? ` ("${s.title.slice(0, 60)}")` : ""}`;

export async function runFill(deps: FillDeps, fields: FillField[], submit: string | undefined, signal?: AbortSignal): Promise<FillResult> {
  const d = await deps.driver();
  // Same rule as tools.ts: a yes that arrives after Stop must not act.
  const approve = (toolName: string): Approve => async (action) => {
    if (signal?.aborted) return "aborted";
    const yes = (await deps.askApproval?.({ toolName, action, signal }).catch(() => false)) === true;
    return signal?.aborted ? "aborted" : yes;
  };
  const quiet = withoutSnapshots(d);
  const io: FieldIo = {
    act: (req) => runPageAction(quiet, req, approve(`browser_${req.action}`)),
    probe: async (target, readValue = false) => (await d.evaluate(probeScript(target, readValue))) as FillProbe,
    eval: (script) => d.evaluate(script),
    choose: chooseEnabled() ? (ref, text) => runChoose(quiet, { target: ref, text }, approve("browser_choose")) : undefined,
  };
  // The page after the whole call: with delta results on a delta against the last view the model saw (the per-field snapshots were
  // stubbed, so the baseline is still that view), else the full snapshot.
  const snapshot = async () => {
    if (!deltaEnabled()) return (await runPageAction(d, { action: "snapshot" })).text;
    return presentSnapshot(d, (await d.evaluate(scripts.snapshot(150, false, true))) as PageSnapshot, true);
  };

  if (fields.length === 0) return { outcome: "Nothing to fill: fields is empty.", text: await snapshot() };
  if (fields.length > MAX_FIELDS) return { outcome: `Too many fields (${fields.length}); at most ${MAX_FIELDS} per call. Nothing was filled.`, text: await snapshot() };
  d.setActivity?.(`Filling ${fields.length} field${fields.length === 1 ? "" : "s"}`);

  // What each ref names now, so a ref that moves mid-batch (the page changed under us) is caught instead of filling the wrong control.
  const initial = await Promise.all(fields.map((f) => io.probe(f.ref).catch((e) => ({ error: String(e), kind: "other" as FillKind, label: f.ref }))));
  const lines: string[] = [];
  const notes: string[] = [];
  let stoppedAt: number | undefined;
  for (const [i, f] of fields.entries()) {
    const label = initial[i]!.label;
    if (signal?.aborted) {
      lines.push(`${label}: not filled, the run was stopped ✗`);
      stoppedAt = i;
      break;
    }
    let outcome: FieldOutcome;
    try {
      const probe = await io.probe(f.ref);
      if (probe.error) outcome = failed(label, probe.error);
      else if (probe.label !== initial[i]!.label || probe.kind !== initial[i]!.kind) outcome = failed(label, `the page changed: ${f.ref} no longer names the same control`);
      else if (probe.kind === "select") outcome = await fillSelect(io, f.ref, label, f.value);
      else if (probe.kind === "checkbox" || probe.kind === "radio") outcome = await fillToggle(io, f.ref, label, probe, f.value);
      else if (probe.kind === "combobox") outcome = await fillCombobox(io, f.ref, label, f.value);
      else if (probe.kind === "text") outcome = await fillText(io, f.ref, label, f.value);
      else outcome = failed(label, "not a fillable control (use browser_click for buttons and links)");
    } catch (e) {
      outcome = failed(label, firstSentence(e instanceof Error ? e.message : String(e)));
    }
    lines.push(outcome.line);
    if (outcome.note) notes.push(outcome.note);
    if (!outcome.ok) {
      stoppedAt = i;
      break;
    }
  }

  const done = stoppedAt === undefined ? fields.length : stoppedAt;
  let summary = stoppedAt === undefined ? `Filled ${done}/${fields.length} fields.` : `Filled ${done}/${fields.length} fields; stopped at field ${stoppedAt + 1} (${initial[stoppedAt]!.label}).`;
  let text: string | undefined;
  if (stoppedAt !== undefined) {
    summary += submit ? " Not submitted." : "";
  } else if (submit) {
    const before = await d.state();
    const clicked = await runPageAction(d, { action: "click", target: submit }, approve("browser_click"));
    const after = await d.state().catch(() => before);
    text = clicked.text;
    if (clicked.note) {
      notes.push(clicked.note);
      lines.push(`Submit: ${firstSentence(clicked.note)} ✗`);
      summary += " Not submitted.";
    } else {
      const moved = after.url !== before.url || after.title !== before.title;
      lines.push(`Submit: ${clicked.outcome ?? "clicked"} ${moved ? `Page: ${where(before)} -> ${where(after)}.` : "No URL or title change."}`);
      summary += " Submitted.";
    }
  }
  return { outcome: [...lines, summary].join("\n"), text: text ?? (await snapshot()), note: notes.length ? notes.join(" ") : undefined };
}

/** Registers browser_fill. `respond` is tools.ts's result builder (url, title, result, note, then the text part). */
export function registerFillTool(pi: ExtensionAPI, deps: FillDeps, respond: (state: PageState, result: { outcome?: string; text?: string; note?: string }) => unknown) {
  pi.registerTool(
    defineTool({
      name: "browser_fill",
      label: "Browser: fill form",
      description:
        "Fill several form fields in one call, in order, then optionally press a submit button. Each field is {ref, value}: text inputs and textareas are typed, dropdowns choose the option with that visible text, checkboxes and radios take \"true\"/\"false\" or their label, a combobox with a suggestion list is typed and the best-matching suggestion is picked. Every field is read back and reported as one line (✓ or ✗). The first field that fails stops the batch and nothing is submitted; fix it and call again with the remaining fields. Password, card, code and PIN fields are refused: the user types those in the pane. A submit that looks like buying, paying, sending, deleting or signing in is held for the user's approval like browser_click. Refs come from browser_snapshot and stay valid for the whole call.",
      promptSnippet: "browser_fill: fill several form fields (and optionally submit) in one call",
      parameters: Type.Object({
        fields: Type.Array(Type.Object({ ref: Type.String({ description: "Ref from browser_snapshot, e.g. e7" }), value: Type.String({ description: "Text to type, option to choose, or true/false for a checkbox" }) }), { description: "Fields in the order to fill them" }),
        submit: Type.Optional(Type.String({ description: "Ref of the button to click after every field succeeded" })),
      }),
      execute: async (_id, { fields, submit }, signal) => {
        const d = await deps.driver();
        const res = await runFill(deps, fields, submit, signal);
        return respond(await d.state(), res) as never;
      },
    }),
  );
}
