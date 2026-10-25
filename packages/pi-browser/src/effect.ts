/**
 * Effect summary: after click, type, select or press, say in plain words what the page did, so the model reads what
 * happened and not only what was attempted. Pure functions over two observations (see `scripts.observe`), taken before the
 * action and after it settled. Generic: only URL, title, native values and standard ARIA state.
 */
import { cutInline, type ControlReading, type PageObservation } from "./page-scripts.ts";

export type EffectOp = "click" | "type" | "select" | "press";

export const NO_VISIBLE_CHANGE = "No visible change yet.";

/**
 * Effect feedback is off unless PI_BROWSER_EFFECT_FEEDBACK=1. A decision-point test showed no net gain from it, and it costs two page reads around every action. Off, the tools skip the reads and keep the
 * plain result wording. Read at call time, so a test can switch it.
 */
export const effectFeedbackEnabled = (): boolean => process.env.PI_BROWSER_EFFECT_FEEDBACK === "1";

const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const TOGGLES = new Set(["checked", "unchecked", "mixed", "selected", "not selected", "pressed", "not pressed"]);

/** A value as the model should see it: quoted, and with an explicit marker when it was long. */
const quote = (s: string, max = 80) => JSON.stringify(s.length > max ? `${s.slice(0, max)}${cutInline(s.length - max)}` : s);

/** Path (and host when it is another site) of a URL; the full URL is already in the tool result. */
function shortUrl(href: string, base: string): string {
  try {
    const u = new URL(href);
    const here = new URL(base);
    return (u.host === here.host ? u.pathname : u.host + u.pathname).slice(0, 80);
  } catch {
    return href.slice(0, 80);
  }
}

/** What the target control shows now. Sensitive fields (password, card number, one-time code) only say whether the value changed. `always`: also when nothing changed. */
function valueLine(was: ControlReading | undefined, now: ControlReading, always: boolean): string | undefined {
  if (now.value === undefined) return undefined;
  const changed = was?.value !== now.value;
  if (!changed && !always) return undefined;
  if (now.sensitive) return `The field value ${changed ? "changed" : "is unchanged"}.`;
  if (TOGGLES.has(now.value)) return `Now ${now.value}${changed && was?.value !== undefined ? ` (was ${was.value})` : changed ? "" : " (unchanged)"}.`;
  const prior = !changed ? "unchanged" : was?.value ? `was ${quote(was.value)}` : "was empty";
  return `The field ${now.value ? `shows ${quote(now.value)}` : "is empty"} (${prior}).`;
}

/**
 * What to tell the model after `op`. `typed` is the text of a browser_type, `submit` whether it pressed Enter. Empty when either observation is missing
 * (the page could not be scripted).
 */
export function describeEffect(op: EffectOp, before: PageObservation | undefined, after: PageObservation | undefined, typed?: string, submit?: boolean): string {
  if (!before || !after) return "";
  const titleChanged = before.title !== after.title;
  const title = titleChanged ? `Title is now ${quote(after.title, 60)}.` : "";
  if (before.href !== after.href) return [`URL changed (was ${shortUrl(before.href, after.href)}).`, title].filter(Boolean).join(" ");

  const was = before.target ?? undefined;
  const now = after.target ?? undefined;
  const parts: string[] = [];
  let changed = before.fp !== after.fp || titleChanged;

  if (title) parts.push(title);
  // Search and chat boxes clear themselves on Enter, so an empty field after a submit says little.
  const cleared = op === "type" && !!typed && !!submit && !!now?.native && !now.sensitive && now.value === "";
  const line = cleared ? "The field is empty now (it may have been submitted)." : now?.control ? valueLine(was, now, op !== "click") : undefined;
  if (line) {
    parts.push(line);
    if (was?.value !== now!.value) changed = true;
  }
  // A value the page did not take, or changed into something else: the one thing the model must not assume away.
  if (op === "type" && typed && now?.native && !now.sensitive && now.value !== undefined) {
    const shown = norm(now.value);
    if (!shown) {
      if (!submit) parts.push("The text did not stick.");
    } else if (!shown.includes(norm(typed)) && !norm(typed).includes(shown)) {
      parts.push(`The field shows ${quote(now.value)}, which differs from the text sent (it may be formatted).`);
    }
  }

  const open = !!now?.expanded || !!after.focus?.expanded || after.options > before.options;
  const wasOpen = !!was?.expanded || !!before.focus?.expanded || before.options > 0;
  const count = after.options ? ` with ${after.options} option${after.options > 1 ? "s" : ""}` : "";
  const typedInPopup = op === "type" && (now?.popup || after.focus?.popup);
  if (open && (typedInPopup || !wasOpen)) {
    parts.push(typedInPopup ? `A suggestion list is open${count}; the value is not committed yet; if this field needs a listed value, choose one.` : `A list is open${count}.`);
    changed ||= !wasOpen;
  } else if (!open && wasOpen) {
    parts.push("The list closed.");
    changed = true;
  } else if (typedInPopup && !open) parts.push("No suggestion list opened yet.");

  // Focus elsewhere than the target: a field that took the text (overlay inputs), or where Tab and Enter went.
  const f = after.focus;
  const was0 = before.focus;
  if (f && !f.onTarget && (f.editable || op === "press") && (f.role !== was0?.role || f.name !== was0?.name || f.value !== was0?.value)) {
    const where = `${f.role}${f.name ? ` ${quote(f.name, 40)}` : ""}`;
    parts.push(`Focus is now on ${where}${f.editable && !f.sensitive && f.value ? ` (shows ${quote(f.value)})` : ""}.`);
    changed = true;
  }

  if (!changed) parts.push(NO_VISIBLE_CHANGE);
  return [changed ? "URL unchanged." : "", ...parts].filter(Boolean).join(" ");
}
