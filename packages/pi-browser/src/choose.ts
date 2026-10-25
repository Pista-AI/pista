/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * browser_choose(ref, text): type into a combobox / autocomplete field, wait for its suggestion list, pick the best match and check the
 * value was committed. Opt-in (PI_BROWSER_CHOOSE=1). Generic: it keys only on ARIA roles and attributes (role=option in the listbox linked by
 * aria-controls / aria-owns / aria-activedescendant, else the nearest visible role=listbox) and on native `<datalist>` and `<select>` options.
 * Safety is the existing stops: secret fields are refused before anything is typed, and a consequential-looking option is held for the
 * user's approval (through the same approver browser_click uses) before it is clicked.
 */
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { settle, type ActionResult } from "./actions.ts";
import type { RiskApprover } from "./approval.ts";
import type { BrowserDriver, PageState } from "./driver.ts";
import { deltaEnabled, presentSnapshot } from "./delta.ts";
import { call, formatSnapshot, scripts, type PageSnapshot, type PreparedTarget } from "./page-scripts.ts";
import { abortedNote, consequentialClick, consequentialPress, passwordNote, stopNote, type FocusedControl } from "./safety.ts";

export const chooseEnabled = (): boolean => process.env.PI_BROWSER_CHOOSE === "1";

/** How long to wait for the suggestion list after typing, and how often to look. */
export const CHOOSE_LIST_MAX_MS = 1500;
export const CHOOSE_POLL_MS = 50;
/** A list that looks the same as before typing is probably the old one: give the page this long to replace it. */
const STALE_LIST_MS = 500;
/** After picking: how long the field and list get to settle before the pick counts as failed. */
const VERIFY_MAX_MS = 400;
const MAX_LISTED = 8;
const FOCUS_MAX_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ChooseItem {
  /** The whole label, on one line. */
  text: string;
  /** Its main part: the first line, up to the first comma ("Barcelona, Spain" -> "Barcelona"). */
  main: string;
}
interface ChooseBegin {
  error?: string;
  secret?: boolean;
  mode?: "select" | "field";
  /** Text can be typed into the field. */
  editable?: boolean;
  role?: string;
  name?: string;
}
interface ChooseScan {
  source: "select" | "datalist" | "listbox" | "none";
  items: ChooseItem[];
}
interface ChooseRead {
  /** What the field the options belong to shows now. */
  value: string;
  /** What the element the agent pointed at shows now (a widget may hand its text to an overlay input, or the other way round). */
  targetValue: string;
  open: boolean;
  secret?: boolean;
}
interface ChoosePoint {
  error?: string;
  x?: number;
  y?: number;
  native?: boolean;
  covered?: boolean;
}

declare const __isSecret: (el: Element, accessibleName?: string) => boolean;

/**
 * One page script with several operations (they share helpers and the state kept on `window.__pistaChoose`). It is serialized into the
 * page, so it must stay self-contained.
 *  begin(target): resolve the field (the focused editable one, if the click moved focus into an overlay input) and report what it is.
 *  clear: empty the field. scan: find the options. point(i): where to click option i. commit(i): pick option i without trusted input.
 *  focus: refocus the field. read: what the field shows and whether the list is open.
 */
function pageChoose(op: string, arg?: string | number): unknown {
  type State = { target: Element | null; anchor: Element | null; items: Element[]; source: string };
  const w = window as unknown as {
    __pistaRefs?: Map<string, WeakRef<Element>>;
    __pistaDescribe?: (el: Element) => { role: string; name: string };
    __pistaChoose?: State;
  };
  const st: State = (w.__pistaChoose ??= { target: null, anchor: null, items: [], source: "none" });
  const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const visible = (e: Element): boolean => {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const check = (e as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility;
    return !check || check.call(e, { opacityProperty: true, visibilityProperty: true });
  };
  const editableText = (e: Element | null): boolean => {
    if (!e) return false;
    if (e.tagName === "TEXTAREA") return true;
    if (e.tagName === "INPUT") return !["checkbox", "radio", "button", "submit", "reset", "image", "file", "range", "color", "hidden"].includes((e as HTMLInputElement).type);
    return (e as HTMLElement).isContentEditable;
  };
  const activeElement = (): Element | null => {
    let a = document.activeElement as HTMLElement | null;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement as HTMLElement;
    return a;
  };
  const shown = (e: Element | null): string => {
    if (!e) return "";
    if (e.tagName === "INPUT" || e.tagName === "TEXTAREA") return (e as HTMLInputElement).value;
    if (e.tagName === "SELECT") return squash((e as HTMLSelectElement).selectedOptions[0]?.text);
    return squash((e as HTMLElement).innerText || e.textContent);
  };
  const setValue = (e: Element, v: string) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), "value")?.set;
    if (setter) setter.call(e, v);
    else (e as HTMLInputElement).value = v;
  };
  const fire = (e: Element, names: string[]) => names.forEach((n) => e.dispatchEvent(new Event(n, { bubbles: true })));
  const describe = (e: Element) => {
    const d = w.__pistaDescribe?.(e);
    const labels = (e as HTMLInputElement).labels;
    return {
      role: d?.role ?? e.getAttribute("role") ?? (e.tagName === "SELECT" ? "combobox" : "textbox"),
      name: squash(d?.name || e.getAttribute("aria-label") || (labels && labels.length ? [...labels].map((l) => l.innerText).join(" ") : "") || e.getAttribute("placeholder")),
    };
  };
  const labelOf = (e: Element): { text: string; main: string } => {
    const lines = ((e as HTMLElement).innerText || e.textContent || e.getAttribute("aria-label") || "").split(/\n+/).map(squash).filter(Boolean);
    const text = lines.join(" ");
    return { text, main: (lines[0] ?? "").split(",")[0]!.trim() || text };
  };
  const visibleOptions = (root: Element): Element[] => (root.matches("[role=option]") ? [root] : [...root.querySelectorAll("[role=option]")]).filter(visible);

  if (op === "begin") {
    const target = String(arg);
    let el: Element | null | undefined;
    if (/^e\d+$/.test(target)) el = w.__pistaRefs?.get(target)?.deref();
    else {
      try {
        el = document.querySelector(target);
      } catch {
        return { error: `"${target}" is neither a snapshot ref (like e12) nor a valid CSS selector.` };
      }
    }
    if (!el || !el.isConnected) return { error: `Ref ${target} is not on the page (anymore). Take a new browser_snapshot and use its refs.` };
    const active = activeElement();
    const anchor = el.tagName === "SELECT" ? el : active && editableText(active) ? active : el;
    st.target = el;
    st.anchor = anchor;
    st.items = [];
    st.source = "none";
    const d = describe(el);
    return { mode: anchor.tagName === "SELECT" ? "select" : "field", editable: editableText(anchor), role: d.role, name: d.name, secret: __isSecret(anchor, describe(anchor).name) || __isSecret(el, d.name) };
  }

  const anchor = st.anchor;
  const target = st.target;
  if (!anchor || !target || !anchor.isConnected) return op === "read" ? { value: "", targetValue: "", open: false } : { source: "none", items: [] };

  if (op === "focus") {
    (anchor as HTMLElement).focus();
    return true;
  }
  if (op === "clear") {
    (anchor as HTMLElement).focus();
    if (anchor.tagName === "INPUT" || anchor.tagName === "TEXTAREA") {
      if ((anchor as HTMLInputElement).value) {
        setValue(anchor, "");
        fire(anchor, ["input"]);
      }
    } else if ((anchor as HTMLElement).isContentEditable) {
      anchor.textContent = "";
      fire(anchor, ["input"]);
    }
    return true;
  }
  if (op === "read") {
    if (__isSecret(anchor, describe(anchor).name) || __isSecret(target, describe(target).name)) return { value: "", targetValue: "", open: false, secret: true };
    const first = st.items[0];
    const listed = !!first && first.isConnected;
    const expandedAndShown = (e: Element) => e.getAttribute("aria-expanded") === "true" && visible(e);
    const open = st.source === "listbox" && (listed ? visible(first!) : expandedAndShown(anchor) || expandedAndShown(target));
    return { value: shown(anchor).slice(0, 200), targetValue: shown(target).slice(0, 200), open };
  }
  if (op === "scan") {
    let items: Element[] = [];
    let source = "none";
    const labels: { text: string; main: string }[] = [];
    if (anchor.tagName === "SELECT") {
      items = [...(anchor as HTMLSelectElement).options].filter((o) => !o.disabled && o.value !== "");
      source = "select";
      for (const o of items) {
        const t = squash((o as HTMLOptionElement).text);
        labels.push({ text: t, main: t });
      }
    } else {
      // 1. The listbox the field points at: aria-controls / aria-owns on the field (or on the element the agent pointed at), or the listbox of its active descendant.
      const ids = [anchor, target].flatMap((e) => [e.getAttribute("aria-controls"), e.getAttribute("aria-owns")]).flatMap((v) => (v ?? "").split(/\s+/)).filter(Boolean);
      const containers: Element[] = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
      const activeId = anchor.getAttribute("aria-activedescendant");
      const activeOption = activeId ? document.getElementById(activeId) : null;
      if (activeOption) containers.push(activeOption.closest("[role=listbox]") ?? activeOption.parentElement ?? activeOption);
      for (const c of containers) {
        const found = visibleOptions(c);
        if (found.length) {
          items = found;
          source = "listbox";
          break;
        }
      }
      // 2. A native <input list>.
      const datalist = (anchor as HTMLInputElement).list;
      if (!items.length && datalist) {
        items = [...datalist.options].filter((o) => !o.disabled && o.value !== "");
        if (items.length) source = "datalist";
      }
      // 3. The nearest visible listbox: the first one inside the field's closest ancestor that holds one, else the closest on screen.
      if (!items.length) {
        const lists = [...document.querySelectorAll("[role=listbox]")]
          .filter((l) => visible(l) && !l.contains(anchor))
          .map((l) => ({ l, found: visibleOptions(l) }))
          .filter((x) => x.found.length);
        let pick: (typeof lists)[number] | undefined;
        for (let up = anchor.parentElement, depth = 0; up && !pick && depth < 8; up = up.parentElement, depth++) pick = lists.find((x) => up!.contains(x.l));
        if (!pick && lists.length) {
          const a = anchor.getBoundingClientRect();
          const dist = (r: DOMRect) => Math.hypot(r.left + r.width / 2 - (a.left + a.width / 2), r.top + r.height / 2 - (a.top + a.height / 2));
          pick = lists.reduce((best, x) => (dist(x.l.getBoundingClientRect()) < dist(best.l.getBoundingClientRect()) ? x : best));
        }
        if (pick) {
          items = pick.found;
          source = "listbox";
        }
      }
      for (const o of items) {
        if (source === "datalist") {
          const opt = o as HTMLOptionElement;
          labels.push({ text: squash(opt.label && opt.label !== opt.value ? `${opt.value} ${opt.label}` : opt.value), main: squash(opt.value) });
        } else labels.push(labelOf(o));
      }
    }
    st.items = items;
    st.source = source;
    return { source, items: labels };
  }

  const el = st.items[Number(arg)];
  if (!el || !el.isConnected) return { error: "The option is gone." };
  if (op === "point") {
    el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    return { x, y, native: st.source !== "listbox", covered: !!hit && hit !== el && !el.contains(hit) && !hit.contains(el) };
  }
  if (op === "commit") {
    if (st.source === "select") {
      (el as HTMLOptionElement).selected = true;
      fire(anchor, ["input", "change"]);
    } else if (st.source === "datalist") {
      setValue(anchor, (el as HTMLOptionElement).value);
      fire(anchor, ["input", "change"]);
    } else {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      (el as HTMLElement).click();
    }
    return true;
  }
  return { error: `unknown op ${op}` };
}

const run = <T>(driver: BrowserDriver, op: string, arg?: string | number) => driver.evaluate(call(pageChoose, op, arg)) as Promise<T>;

/** Case-, accent- and whitespace-insensitive form for comparing labels. */
export const normalize = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The best option for `query`: exact label, then a label starting with it, then one containing it (a label is the whole text or its main part).
 * The shortest label wins ties, then the earliest. Undefined when none matches.
 */
export function bestMatch(items: ChooseItem[], query: string): number | undefined {
  const q = normalize(query);
  if (!q) return undefined;
  let best: { i: number; rank: number; len: number } | undefined;
  items.forEach((item, i) => {
    const forms = [normalize(item.text), normalize(item.main)];
    const rank = forms.some((f) => f === q) ? 0 : forms.some((f) => f.startsWith(q)) ? 1 : forms.some((f) => f.includes(q)) ? 2 : undefined;
    if (rank === undefined) return;
    const len = item.text.length;
    if (!best || rank < best.rank || (rank === best.rank && len < best.len)) best = { i, rank, len };
  });
  return best?.i;
}

const cap = (s: string, max = 80) => (s.length > max ? `${s.slice(0, max)}…` : s);
/** A page-supplied label as it is quoted back to the model. */
const shownLabel = (s: string) => cap(s).replace(/"/g, "'");
/** The words the model reads for the field: `combobox "Where to?"`. */
const fieldLabel = (b: ChooseBegin) => `${b.role ?? "field"}${b.name ? ` "${shownLabel(b.name)}"` : ""}`;
/** Does a field's text show the chosen option's main text? */
const showsChoice = (value: string, item: ChooseItem) => !!normalize(item.main) && normalize(value).includes(normalize(item.main));

/**
 * Types `text` into the field behind `target`, waits for its options, picks the best match and checks that the value was committed.
 * `approve` is the same user-approval path browser_click uses (see approval.ts).
 */
/** `ok`: the value was chosen and is committed (browser_fill relies on it). */
export type ChooseResult = ActionResult & { ok?: boolean };

export async function runChoose(driver: BrowserDriver, req: { target: string; text: string }, approve: (action: string) => Promise<boolean | "aborted">): Promise<ChooseResult> {
  driver.setActivity?.(`Choosing "${cap(req.text, 40)}" in ${req.target}`);
  // With delta results on (the default) the refs are stable and the result may be a delta, like any acting tool's.
  const delta = deltaEnabled();
  const done = async (outcome: string, ok = false): Promise<ChooseResult> => {
    const snap = (await driver.evaluate(scripts.snapshot(150, false, delta))) as PageSnapshot;
    return { outcome, ok, text: delta ? presentSnapshot(driver, snap, true) : formatSnapshot(snap) };
  };

  // Secret fields are refused before anything is typed or clicked, exactly like browser_type.
  const t = (await driver.evaluate(scripts.prepare(req.target, "type"))) as PreparedTarget;
  if (t.error) return { note: t.error };
  if (t.password) return { note: passwordNote(t.label) };
  const first = await run<ChooseBegin>(driver, "begin", req.target);
  if (first.error) return { note: first.error };

  // Click the field like a person would, then work with whatever got focus (some widgets swap in an overlay input on click).
  if (first.mode !== "select" && t.x !== undefined && t.y !== undefined && (await driver.input({ type: "click", x: t.x, y: t.y }))) {
    for (let waited = 0, ready = 0; waited < FOCUS_MAX_MS && ready < 2; waited += 25) {
      ready = (await driver.evaluate(scripts.focusReady(req.target)).catch(() => false)) === true ? ready + 1 : 0;
      if (ready < 2) await sleep(25);
    }
  }
  const begin = await run<ChooseBegin>(driver, "begin", req.target);
  if (begin.error) return { note: begin.error };
  if (begin.secret) return { note: passwordNote(t.label) };
  const label = fieldLabel(begin);

  // 1-2. Clear the field and type.
  let baseline = "";
  if (begin.mode === "field" && begin.editable) {
    await run(driver, "clear");
    baseline = (await run<ChooseScan>(driver, "scan")).items.map((i) => i.text).join("|");
    const typed = await driver.input({ type: "text", text: req.text }).catch(() => false);
    if (!typed) await driver.evaluate(scripts.syntheticInput(req.target, "type", req.text));
  }

  // 3. Wait for options. A list that appears is trusted once it holds still, and, when it looks like the one from before typing, once the page had time to replace it.
  let scan: ChooseScan = { source: "none", items: [] };
  const start = Date.now();
  let last = "";
  let stable = 0;
  while (Date.now() - start < CHOOSE_LIST_MAX_MS) {
    scan = await run<ChooseScan>(driver, "scan");
    const sig = scan.items.map((i) => i.text).join("|");
    stable = sig && sig === last ? stable + 1 : 0;
    last = sig;
    const fresh = sig !== baseline || Date.now() - start >= STALE_LIST_MS;
    if (scan.items.length && (scan.source !== "listbox" || (stable >= 1 && fresh))) break;
    await sleep(CHOOSE_POLL_MS);
  }
  if (!scan.items.length) {
    return done(`No suggestions appeared after typing "${shownLabel(req.text)}" in ${label}. The text is still in the field. Try a shorter or different text, or look at the page with browser_snapshot.`);
  }

  // 4. Best match.
  const index = bestMatch(scan.items, req.text);
  if (index === undefined) {
    const names = scan.items.slice(0, MAX_LISTED).map((i) => shownLabel(i.text));
    return done(`No option matched "${shownLabel(req.text)}"; options were: ${names.join(", ")}${scan.items.length > MAX_LISTED ? ` (first ${MAX_LISTED})` : ""}.`);
  }
  let at = index;
  let chosen = scan.items[at]!;

  // The option is about to be clicked, so it is judged like any clickable (an option can be named "Delete account" or "Sign in").
  const stop = consequentialClick(undefined, chosen.text);
  if (stop) {
    const answer = await approve(stop);
    const effect = "The text was typed but no option was chosen.";
    if (answer === "aborted") return { note: abortedNote(stop, effect) };
    if (!answer) return { note: stopNote(stop, effect) };
    // Their yes was for this option: make sure it is still there.
    const again = await run<ChooseScan>(driver, "scan");
    at = again.items.findIndex((i) => i.text === chosen.text);
    if (at < 0) return { note: `Stopped: the page changed while the user was deciding, so their approval no longer applies to ${stop}. Take a new browser_snapshot and try again; the user will be asked again.` };
    chosen = again.items[at]!;
  }

  // 5. Pick it: a real click, or the DOM click when something covers the option or trusted input is unavailable. Native options are set directly.
  const pick = async () => {
    const p = await run<ChoosePoint>(driver, "point", at);
    if (p.error) return;
    const trusted = !p.native && !p.covered && p.x !== undefined && p.y !== undefined && (await driver.input({ type: "click", x: p.x, y: p.y }).catch(() => false));
    if (!trusted) await run(driver, "commit", at);
  };
  // 6. Verify: the field shows the option's main text and the list is closed.
  const verify = async () => {
    const good = (r: ChooseRead) => !r.secret && !r.open && (showsChoice(r.value, chosen) || showsChoice(r.targetValue, chosen));
    let read = await run<ChooseRead>(driver, "read");
    for (let waited = 0; waited < VERIFY_MAX_MS && !good(read) && !read.secret; waited += 50) {
      await sleep(50);
      read = await run<ChooseRead>(driver, "read");
    }
    return { read, ok: good(read) };
  };
  await pick();
  await settle(driver);
  let result = await verify();

  // The click did not commit it and the list is still up: ArrowDown to the option and Enter, as a keyboard user would.
  if (!result.ok && scan.source === "listbox" && result.read.open && !result.read.secret) {
    await run(driver, "focus");
    const peek = (await driver.evaluate(scripts.prepare(":focus", "peek")).catch(() => undefined)) as FocusedControl | undefined;
    const enterStop = consequentialPress("Enter", peek && typeof peek === "object" ? peek : undefined);
    const answer = enterStop ? await approve(enterStop) : true;
    if (answer === "aborted") return { note: abortedNote(enterStop!, "No option was chosen by key.") };
    if (answer) {
      for (let i = 0; i <= at; i++) await driver.input({ type: "key", key: "ArrowDown" });
      await driver.input({ type: "key", key: "Enter" });
      await settle(driver);
      result = await verify();
    }
  }

  const shows = (v: string) => (v ? `"${shownLabel(v)}"` : "empty");
  if (result.ok) {
    const value = showsChoice(result.read.value, chosen) ? result.read.value : result.read.targetValue;
    return done(`Chose "${shownLabel(chosen.text)}" in ${label}. The field now shows ${shows(value)}.`, true);
  }
  const value = result.read.value || result.read.targetValue;
  return done(`Clicked "${shownLabel(chosen.text)}" but the field still shows ${shows(value)}${result.read.open ? " and the suggestion list is still open" : ""}. The value is not committed.`);
}

/**
 * Registers browser_choose when PI_BROWSER_CHOOSE=1 (read at registration). `respond` is tools.ts's result builder, so the
 * result looks like every other action tool's.
 */
export function registerChooseTool(
  pi: ExtensionAPI,
  driver: () => BrowserDriver | Promise<BrowserDriver>,
  respond: (state: PageState, result?: ActionResult) => unknown,
  askApproval?: RiskApprover,
) {
  if (!chooseEnabled()) return;
  pi.registerTool(
    defineTool({
      name: "browser_choose",
      label: "Browser: choose from suggestions",
      description:
        "Fill a combobox, autocomplete or dropdown field and commit a value from its list in ONE call: clears the field, types the text, waits for the suggestions, clicks the best match and checks the value stuck. Use it instead of browser_type for fields like 'Where to?' where the typed text must be picked from a list. Works on <select> and <input list> too. Give the text the option should contain, e.g. 'Barcelona'. Password and other secret fields are refused; an option that looks like buying, paying, sending or deleting is held for the user's approval.",
      parameters: Type.Object({
        ref: Type.String({ description: "Ref of the field from browser_snapshot, e.g. e7 (a CSS selector also works)" }),
        text: Type.String({ description: "Text to type and to match against the options, e.g. Barcelona" }),
      }),
      execute: async (_id, { ref, text }, signal) => {
        const d = await driver();
        const approve = async (action: string): Promise<boolean | "aborted"> => {
          if (signal?.aborted) return "aborted";
          const yes = (await askApproval?.({ toolName: "browser_choose", action, signal }).catch(() => false)) === true;
          return signal?.aborted ? "aborted" : yes;
        };
        const result = await runChoose(d, { target: ref, text }, approve);
        return respond(await d.state(), result) as never;
      },
    }),
  );
}
