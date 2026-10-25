import { deltaEnabled, presentSnapshot } from "./delta.ts";
import type { BrowserDriver } from "./driver.ts";
import { describeEffect, effectFeedbackEnabled, type EffectOp } from "./effect.ts";
import { cutMarker, formatSnapshot, scripts, type PageObservation, type PageSnapshot, type PreparedTarget } from "./page-scripts.ts";
import { abortedNote, consequentialClick, consequentialPress, consequentialSubmit, normalizeKey, passwordNote, stopNote } from "./safety.ts";

/** `target` is a ref from the latest snapshot (e.g. "e12") or, as a fallback, a CSS selector. */
export type PageAction =
  | { action: "snapshot"; maxElements?: number }
  | { action: "read"; maxChars?: number }
  /** A click on something that looks consequential (see safety.ts) is held unless the user approves it (see `Approve`). */
  | { action: "click"; target: string }
  /** With `submit`, Enter that would press a consequential submit control (see safety.ts) is skipped unless the user approves it. */
  | { action: "type"; target: string; text: string; submit?: boolean }
  | { action: "select"; target: string; option: string }
  /** Enter or Space that would submit a form or activate a consequential control is held like a click. */
  | { action: "press"; key: string }
  | { action: "scroll"; direction: "up" | "down"; target?: string };

export interface ActionResult {
  /** One-line outcome, e.g. `Clicked button "Search".` */
  outcome?: string;
  /** Snapshot or page text. */
  text?: string;
  /** Why the action didn't happen; the agent should correct course. */
  note?: string;
}

/** Settling after an action: wait for the page to render, not for a fixed time. */
export const FRAMES_TIMEOUT_MS = 100;
/** After the frames, how long to keep looking for a navigation that started late (frameStartedLoading can trail the click). */
export const NAVIGATION_GRACE_MS = 100;
export const NAVIGATION_GRACE_POLL_MS = 25;
/** While a page is loading: how often to look, and when to give up. */
export const LOAD_POLL_MS = 50;
export const LOAD_MAX_MS = 10_000;
/** Extra time for a popup list (combobox, listbox, search suggestions) to appear, and how often to look for it. */
export const POPUP_EXTRA_MS = 200;
export const POPUP_POLL_MS = 50;
/** After clicking a field to type into it: how often to check that focus arrived, and the longest wait. */
export const FOCUS_POLL_MS = 25;
export const FOCUS_MAX_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Decides whether a held consequential action (`action` reads like `clicking button "Place order"`) may go ahead.
 * Only the user can say yes, through the host (see approval.ts); the model never supplies it. Without one, every stop stands.
 * "aborted" means the user pressed Stop while the question was open: nothing may be done, not even the harmless part of an action.
 */
export type Approve = (action: string) => Promise<boolean | "aborted">;

/**
 * Runs one page action through a driver. Actions prefer trusted input and fall back to DOM
 * events; every action that changes the page returns a fresh snapshot so the agent sees the
 * effect without another call.
 */
export async function runPageAction(driver: BrowserDriver, req: PageAction, approve: Approve = async () => false): Promise<ActionResult> {
  driver.setActivity?.(describe(req));
  const delta = deltaEnabled();
  /** `fromAction`: the result of an acting tool, which may be a delta (on unless PI_BROWSER_DELTA=0); browser_snapshot always gets the full list. */
  const snapshot = async (max = 150, fromAction = false, scrolled = false) => {
    const snap = (await driver.evaluate(scripts.snapshot(max, false, delta))) as PageSnapshot;
    return delta ? presentSnapshot(driver, snap, fromAction, scrolled) : formatSnapshot(snap);
  };
  const feedback = effectFeedbackEnabled();
  /** The page as it is now, or undefined when it can't be scripted (mid-navigation) or effect feedback is off (no page read at all). Read-only, one evaluate. */
  const observe = async (target?: string): Promise<PageObservation | undefined> => {
    if (!feedback) return undefined;
    const o = (await driver.evaluate(scripts.observe(target)).catch(() => undefined)) as PageObservation | undefined;
    return o && typeof o.fp === "string" ? o : undefined;
  };
  /** Settles, then appends what the page actually did (compared with `watch.before`) to the outcome. `arg` is the typed text. */
  const after = async (outcome: string, popup?: SettleOptions, watch?: { op: EffectOp; target?: string; before: PageObservation | undefined; arg?: string; submit?: boolean }): Promise<ActionResult> => {
    await settle(driver, popup);
    if (!watch || !feedback) return { outcome, text: await snapshot(150, true, popup?.noNavigation) };
    // Observed before the snapshot, which renumbers the refs. A page that is mid-navigation can't be scripted: its URL still tells.
    let now = await observe(watch.target);
    if (!now && watch.before) {
      const state = await driver.state().catch(() => undefined);
      if (state && state.url !== watch.before.href) now = { href: state.url, title: state.title, fp: "", options: 0 };
    }
    const effect = describeEffect(watch.op, watch.before, now, watch.arg, watch.submit);
    return { outcome: [outcome, effect].filter(Boolean).join(" "), text: await snapshot(150, true, popup?.noNavigation) };
  };
  /** Fingerprint before the action, so settle can tell when a popup list has appeared. */
  const baseline = async (role: string | undefined, roles: string[]): Promise<SettleOptions | undefined> =>
    role && roles.includes(role) ? { popupBaseline: String(await driver.evaluate(scripts.probe()).catch(() => "")) } : undefined;
  const prepare = async (target: string, op: string, arg?: string) => (await driver.evaluate(scripts.prepare(target, op, arg))) as PreparedTarget;
  /**
   * Asks the user about a held action and, on a yes, looks at the target again: the page may have changed while they decided
   * (a script swapped the control, a ref now points elsewhere), and their yes was for the control they were shown.
   */
  const confirmStop = async (
    stop: string,
    effect: string,
    before: PreparedTarget,
    again: () => Promise<PreparedTarget | undefined>,
    changedEffect = effect,
  ): Promise<{ note: string; denied?: true; aborted?: true } | { target: PreparedTarget }> => {
    const answer = await approve(stop);
    if (answer === "aborted") return { note: abortedNote(stop, changedEffect), aborted: true };
    if (!answer) return { note: stopNote(stop, effect), denied: true };
    const now = await again().catch(() => undefined);
    if (!now || now.error || now.kind !== before.kind || now.name !== before.name || now.submitName !== before.submitName) {
      return { note: `Stopped: the page changed while the user was deciding, so their approval no longer applies to ${stop}. ${changedEffect} Take a new browser_snapshot and try again; the user will be asked again.` };
    }
    return { target: now };
  };

  switch (req.action) {
    case "snapshot":
      return { text: await snapshot(req.maxElements ?? 150) };
    case "read": {
      const text = String(await driver.evaluate("document.body ? document.body.innerText : ''"));
      const max = req.maxChars ?? 20000;
      return { text: text.length > max ? `${text.slice(0, max)}\n${cutMarker(text.length - max, "chars", "call again with a larger maxChars")}` : text };
    }
    case "click": {
      const before = await observe(req.target);
      let t = await prepare(req.target, "click");
      if (t.error) return { note: t.error };
      const stop = consequentialClick(t.kind, t.name, t.tagKind);
      if (stop) {
        const confirmed = await confirmStop(stop, "Nothing was clicked.", t, () => prepare(req.target, "click"));
        if ("note" in confirmed) return confirmed;
        t = confirmed.target;
      }
      const popup = await baseline(t.role, ["combobox", "listbox"]);
      // A covering element (invisible overlay, sticky header) would swallow a real click, so click through the DOM.
      const trusted = !t.coveredBy && t.x !== undefined && t.y !== undefined && (await driver.input({ type: "click", x: t.x, y: t.y }));
      if (!trusted) await driver.evaluate(scripts.syntheticInput(req.target, "click"));
      const covered = t.coveredBy ? ` (${t.coveredBy} was covering it, so it was clicked directly; if nothing changed, close that element first)` : "";
      return after(`Clicked ${t.label}${covered}.`, popup, { op: "click", target: req.target, before });
    }
    case "type": {
      const before = await observe(req.target);
      let t = await prepare(req.target, "type");
      if (t.error) return { note: t.error };
      if (t.password) return { note: passwordNote(t.label) };
      const submitStop = req.submit ? consequentialSubmit(t.submitName) : undefined;
      let heldSubmit: string | undefined;
      if (submitStop) {
        const confirmed = await confirmStop(submitStop, "The text was typed but the form was not submitted.", t, () => prepare(req.target, "type"), "Nothing was typed.");
        if ("target" in confirmed) t = confirmed.target;
        else if (confirmed.denied) heldSubmit = confirmed.note;
        else return confirmed; // aborted, or the page changed: nothing is clicked or typed
      }
      const submit = req.submit && !heldSubmit;
      // Click the field like a person would, then type into whatever got focus: some widgets swap in an
      // overlay input on click, and only that one accepts text.
      let trusted = false;
      let popup: SettleOptions | undefined;
      if (t.x !== undefined && t.y !== undefined && (await driver.input({ type: "click", x: t.x, y: t.y }))) {
        await waitForFocus(driver, req.target);
        // The baseline is taken once the field has focus, so only what typing does to the page counts as the popup opening.
        popup = await baseline(t.role, ["combobox", "searchbox", "listbox"]);
        const active = (await driver.evaluate(scripts.selectActive())) as { editable: boolean };
        if (!active.editable) await driver.evaluate(scripts.prepare(req.target, "type"));
        trusted = await driver.input({ type: "text", text: req.text });
      }
      if (!trusted) {
        popup ??= await baseline(t.role, ["combobox", "searchbox", "listbox"]);
        await driver.evaluate(scripts.syntheticInput(req.target, "type", req.text, submit));
      } else if (submit) await driver.input({ type: "key", key: "Enter" });
      const typed = await after(`Typed into ${t.label}${submit ? " and submitted" : ""}.`, popup, { op: "type", target: req.target, before, arg: req.text, submit });
      return heldSubmit ? { ...typed, note: heldSubmit } : typed;
    }
    case "select": {
      const before = await observe(req.target);
      const t = await prepare(req.target, "select", req.option);
      if (t.error) return { note: t.error };
      return after(`Selected "${t.value}" in ${t.label}.`, undefined, { op: "select", target: req.target, before });
    }
    case "press": {
      const key = normalizeKey(req.key);
      if (await driver.evaluate(scripts.focusedIsPassword()).catch(() => false)) return { note: passwordNote(undefined) };
      const before = await observe();
      const peek = async () => (await driver.evaluate(scripts.prepare(":focus", "peek"))) as PreparedTarget;
      const focused = await peek().catch(() => undefined);
      const stop = consequentialPress(key, focused && typeof focused === "object" ? focused : undefined);
      if (stop) {
        const confirmed = await confirmStop(stop, `${key} was not pressed.`, focused ?? {}, peek);
        if ("note" in confirmed) return confirmed;
      }
      const trusted = await driver.input({ type: "key", key });
      if (!trusted) await driver.evaluate(scripts.syntheticKey(key));
      return after(`Pressed ${key}.`, undefined, { op: "press", before });
    }
    case "scroll": {
      if (req.target) {
        const t = await prepare(req.target, "scroll", req.direction);
        if (t.error) return { note: t.error };
      } else {
        await driver.evaluate(`window.scrollBy({ top: ${req.direction === "up" ? -0.8 : 0.8} * window.innerHeight })`);
      }
      return after(`Scrolled ${req.direction}.`, { noNavigation: true });
    }
  }
}

/** How long a declined cookie banner gets to disappear before the page is looked at again. */
export const COOKIE_GONE_MS = 300;

/**
 * Declines a cookie or consent banner that offers a reject / necessary-only choice (never accepts) and returns the label of the
 * button it clicked, or "" when there was nothing to decline. Meant to run once per navigation; a page that can't be scripted counts as no banner.
 */
export async function declineCookieBanner(driver: BrowserDriver): Promise<string> {
  try {
    await settle(driver);
    const label = String(await driver.evaluate(scripts.declineCookies()));
    if (!label) return "";
    await settle(driver);
    // A banner that fades out is still there for a moment.
    for (let waited = 0; waited < COOKIE_GONE_MS && String(await driver.evaluate(scripts.declineCookies(true)).catch(() => "")); waited += 50) await sleep(50);
    return label;
  } catch {
    return "";
  }
}

export interface SettleOptions {
  /** `scripts.probe()` taken before what opens the popup (after focus, when typing): when set, settle gives a popup list up to POPUP_EXTRA_MS to change the page. */
  popupBaseline?: string;
  /** The action can't start a navigation (scrolling), so there's no late navigation to look for. */
  noNavigation?: boolean;
}

/** After clicking a field: waits until it holds focus (twice in a row, so a widget that swaps in its own input has done so), at most FOCUS_MAX_MS. */
async function waitForFocus(driver: BrowserDriver, target: string) {
  const start = Date.now();
  let ready = 0;
  while (Date.now() - start < FOCUS_MAX_MS) {
    const focused = await driver.evaluate(scripts.focusReady(target)).catch(() => false);
    ready = focused === true ? ready + 1 : 0;
    if (ready >= 2) return;
    await sleep(FOCUS_POLL_MS);
  }
}

/**
 * Lets an action take effect without fixed pauses: two animation frames (with a timeout, in case the tab is throttled or
 * navigating), a short look for a navigation that started late, and then for as long as the page is loading. Popup lists
 * get a little extra time to open.
 */
export async function settle(driver: BrowserDriver, options: SettleOptions = {}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    driver.evaluate(scripts.frames()).catch(() => undefined),
    new Promise((r) => (timer = setTimeout(r, FRAMES_TIMEOUT_MS))),
  ]);
  clearTimeout(timer);

  let loading = (await driver.state()).loading;
  for (let waited = 0; !loading && !options.noNavigation && waited < NAVIGATION_GRACE_MS; waited += NAVIGATION_GRACE_POLL_MS) {
    await sleep(NAVIGATION_GRACE_POLL_MS);
    loading = (await driver.state()).loading;
  }
  const start = Date.now();
  while (loading && Date.now() - start < LOAD_MAX_MS) {
    await sleep(LOAD_POLL_MS);
    loading = (await driver.state()).loading;
  }

  if (options.popupBaseline !== undefined) {
    const popupStart = Date.now();
    while (Date.now() - popupStart < POPUP_EXTRA_MS) {
      const now = await driver.evaluate(scripts.probe()).catch(() => options.popupBaseline);
      if (now !== options.popupBaseline) break;
      await sleep(POPUP_POLL_MS);
    }
  }
}

export function describe(req: PageAction): string {
  switch (req.action) {
    case "snapshot":
      return "Reading page controls";
    case "read":
      return "Reading page";
    case "click":
      return `Clicking ${req.target}`;
    case "type":
      return `Typing into ${req.target}`;
    case "select":
      return `Selecting "${req.option}"`;
    case "press":
      return `Pressing ${req.key}`;
    case "scroll":
      return `Scrolling ${req.direction}`;
  }
}

/** Polls until the page has stopped loading or `capMs` is up; returns the page state last seen. */
export async function waitForLoad(driver: BrowserDriver, capMs = LOAD_MAX_MS, pollMs = LOAD_POLL_MS) {
  const start = Date.now();
  let state = await driver.state();
  while (state.loading && Date.now() - start < capMs) {
    await sleep(pollMs);
    state = await driver.state();
  }
  return state;
}
