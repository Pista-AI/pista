/**
 * Safety stops of the direct browser tools. They hand a decision back to the user instead of making it:
 * a consequential click, submit or Enter is held until the user approves it through the host (see approval.ts;
 * the model has no argument that lifts a stop), and passwords and other secret fields (card numbers, codes, PINs) are typed by the user in the pane, never by the model.
 */

/** Phrases (regex fragments, spaces match any whitespace) of consequential controls: buying, paying, sending, deleting, signing in or out, accepting. */
const RAW_PHRASES = [
  // English
  "buy", "purchase", "pay", "checkout", "check out", "place order", "order now", "book now", "reserve", "subscribe", "donate", "delete", "remove account", "send", "publish",
  "transfer", "proceed to (?:payment|checkout)", "go to checkout", "continue to payment", "complete (?:your )?(?:purchase|order)", "submit (?:your )?order", "sign up", "register", "log ?in", "sign in", "log ?out", "sign out", "unsubscribe", "accept",
  "confirm(?= (?:order|purchase|payment|booking|delete|deletion)(?![\\p{L}\\p{N}]))",
  // Swedish
  "köp", "betala", "beställ", "skicka", "radera", "ta bort", "logga in", "logga ut", "bekräfta köp", "slutför (?:köp|köpet|beställning|beställningen)", "gå till kassan", "kassa", "kassan", "boka",
  // German
  "kaufen", "bezahlen", "bestellen", "senden", "löschen", "zur kasse", "jetzt kaufen",
  // French
  "acheter", "payer", "commander", "supprimer", "envoyer",
  // Spanish
  "comprar", "pagar", "eliminar", "enviar",
];
const spaced = (p: string) => p.replace(/ (?!\?)/g, "\\s+");
const PHRASES = RAW_PHRASES.map(spaced);
/** The multi-word phrases ("proceed to payment", "jetzt kaufen", "log in", "confirm booking"): specific enough to count anywhere in a short link name. */
const MULTI_WORD_PHRASES = RAW_PHRASES.filter((p) => /[ (]/.test(p)).map(spaced);

/** Whole-word match (also for names with letters like ö and ä, where \b would split words). */
const word = (alternatives: string) => `(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`;

/** "post" and "confirm" are ambiguous ("post office", "confirmation"), so they only count as the whole name ("Post", "Post comment", "Confirm"). */
const WHOLE_NAME = /^\s*(?:post(?:\s+(?:comment|message|reply|review))?|confirm)\s*$/i;

/** Names that look consequential. For "confirm" a following object also counts ("Confirm order"). */
export const RISKY = new RegExp(`${word(PHRASES.join("|"))}|${WHOLE_NAME.source}`, "iu");

/** Links with a name longer than this are sentences or headings; navigating them is not an action. */
const MAX_LINK_WORDS = 4;

/** Roles of controls you type into or toggle; clicking them is not a consequential action. Anything else that can be clicked is checked. */
const NON_ACTING_KINDS = new Set(["textbox", "searchbox", "combobox", "input", "textarea", "select", "checkbox", "radio", "switch", "option", "slider", "spinbutton"]);

const MULTI_WORD = new RegExp(word(MULTI_WORD_PHRASES.join("|")), "iu");
/** A single word from the list ("Post" and "Confirm" are not on it: they count only as a whole name). */
const PHRASE_WORD = new RegExp(word(PHRASES.join("|")), "iu");

/**
 * A link is consequential when its name (or one of several, joined by " / ") is at most MAX_LINK_WORDS words and either holds a multi-word
 * risky phrase anywhere ("Proceed to payment", "Jetzt kaufen", "Slutför köp") or begins with a risky word ("Pay", "Boka", "Checkout", "Buy now");
 * "Post" and "Confirm" alone also count. A single risky word later in the name is a noun in a title, not a command, so "Maternity pay and leave",
 * "Terms of purchase" and "Fakturor och betala senare" navigate freely, as do names longer than MAX_LINK_WORDS and "Payment options" or "Order history".
 */
function isShortRiskyLink(name: string): boolean {
  return name.split(" / ").some((n) => {
    const words = n.trim().split(/\s+/);
    return words.length <= MAX_LINK_WORDS && (MULTI_WORD.test(n) || PHRASE_WORD.test(words[0] ?? "") || WHOLE_NAME.test(n));
  });
}

/** The longest action text, and the longest control kind in it. The text is shown to the user as the approval question and sent to the model. */
const MAX_ACTION = 160;
const MAX_KIND = 20;

/**
 * Page-supplied text made safe to show: format characters (bidi overrides, zero-width) are dropped, other control and
 * line-separator characters become spaces, whitespace is collapsed, quotes and backslashes are escaped, and the result is capped.
 */
function shown(text: string, max: number): string {
  const clean = text.replace(/\p{Cf}/gu, "").replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim().replace(/[\\"]/g, "\\$&");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  return `${/(?:^|[^\\])(?:\\\\)*\\$/.test(cut) ? cut.slice(0, -1) : cut}…`;
}

/** `${verb} ${kind} "${name}"` with the page-supplied parts sanitized and the whole capped at MAX_ACTION. */
function describeControl(verb: string, kind: string | undefined, name: string): string {
  const head = `${verb} ${shown(kind ?? "element", MAX_KIND)} "`;
  return `${head}${shown(name, Math.max(10, MAX_ACTION - head.length - 1))}"`;
}

/**
 * The control a click would hit, as the safety stops see it, or undefined when the click may go ahead. Buttons, submit controls and
 * other clickables are judged by `name` containing a risky word; links by isShortRiskyLink. A page-supplied role that would make a real
 * <a>, <button> or button-like <input> look like a field or toggle (role="textbox") is ignored: `tagKind` (what the tag is) wins.
 * `name` is every name the control is known by (accessible, visible text, image alt, derived), so an icon-only button counts too.
 */
function riskyControl(kind: string | undefined, name: string | undefined, tagKind: string | undefined): string | undefined {
  const effective = kind && NON_ACTING_KINDS.has(kind) && tagKind ? tagKind : kind;
  if (!name || (effective && NON_ACTING_KINDS.has(effective))) return undefined;
  return (effective === "link" ? isShortRiskyLink(name) : RISKY.test(name)) ? (effective ?? "element") : undefined;
}

/** What a stop is about, e.g. `clicking button "Place order"`, or undefined when the click may go ahead. */
export function consequentialClick(kind: string | undefined, name: string | undefined, tagKind?: string): string | undefined {
  const risky = riskyControl(kind, name, tagKind);
  return risky && name ? describeControl("clicking", risky, name) : undefined;
}

/** What a stop is about when Enter in a field would press a consequential submit control. */
export function consequentialSubmit(submitName: string | undefined): string | undefined {
  if (!submitName || !RISKY.test(submitName)) return undefined;
  return describeControl("pressing Enter, which would press", "button", submitName);
}

/** What peeking at the focused element found (see scripts.prepare(":focus", "peek")); `error` means nothing has focus. */
export interface FocusedControl {
  kind?: string;
  name?: string;
  submitName?: string;
  tagKind?: string;
  unreadable?: boolean;
  error?: string;
}

/**
 * One spelling of a key name, used both for the press stop and for the driver, so an alias cannot slip past the stop: the last "+" part of
 * a chord is matched case-insensitively and Return becomes Enter, Spacebar becomes Space (the desktop shell maps Return to Enter too).
 * Modifiers and every other key are left as given.
 */
export function normalizeKey(key: string): string {
  const last = key.length > 1 && key.endsWith("+") ? "+" : (key.split("+").pop() ?? key);
  const canonical = /^(?:return|enter)$/i.test(last) ? "Enter" : /^(?:spacebar|space)$/i.test(last) ? "Space" : /^numpadenter$/i.test(last) ? "NumpadEnter" : last;
  return key.slice(0, key.length - last.length) + canonical;
}

/**
 * The stop for a key press on the focused element. Chords count by their last part (Control+Enter, Meta+Enter and Shift+Enter are Enter).
 * Enter submits the form of a field or activates a focused control; Space activates a focused control. Fails closed: when the peek failed
 * (`focused` undefined) or focus is somewhere unreadable (iframe, shadow root), Enter and Space stop. Deliberately not stopped: Enter in a
 * textarea (a newline; so also Control+Enter there) and in an input outside any form (mostly search boxes).
 */
export function consequentialPress(key: string, focused: FocusedControl | undefined): string | undefined {
  const normalized = normalizeKey(key);
  const last = normalized.length > 1 && normalized.endsWith("+") ? "+" : (normalized.split("+").pop() ?? normalized);
  const enter = /^(?:numpad)?enter$/i.test(last);
  const space = /^(?:space|\s)$/i.test(last);
  if (!enter && !space) return undefined;
  const verb = enter ? "pressing Enter on" : "pressing Space on";
  if (!focused || focused.unreadable) return `${verb} an element that could not be inspected`;
  if (focused.error) return undefined;
  const submit = enter ? consequentialSubmit(focused.submitName) : undefined;
  if (submit) return submit;
  const risky = riskyControl(focused.kind, focused.name, focused.tagKind);
  return risky && focused.name ? describeControl(verb, risky, focused.name) : undefined;
}

/**
 * The one wording of every stop. `action` comes from the functions above; `effect` says what was and was not done.
 * The model cannot lift a stop: only the user's approval through the host can, and repeating the call does not help.
 */
export function stopNote(action: string, effect: string): string {
  return `Stopped: ${action} looks like a consequential action (buying, paying, sending, deleting, signing in or out) and needs the user's approval, which was not given. ${effect} Tell the user what you were about to do and let them decide. Do not repeat this call; it will be stopped again.`;
}

/** The refusal text for typing into a password or other secret field (card number, security code, one-time code, PIN, ID number). Never includes the value. */
export function passwordNote(label: string | undefined): string {
  return `Not typed: ${label ?? "the focused field"} is a password or other secret field (card number, security code, one-time code, PIN, ID number). Nothing was entered. Ask the user to type it themselves in the browser pane, then continue from browser_snapshot.`;
}

/** The result when the user pressed Stop while a held action waited for their answer: the action was not performed at all. */
export function abortedNote(action: string, effect: string): string {
  return `Stopped: the run was stopped while the user was being asked about ${action}. ${effect}`;
}
