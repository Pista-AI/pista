/**
 * Fills a saved login into the browser pane. The secret is bound to the origin it was saved for:
 * the pane URL is checked before every step and again right before the password is typed.
 * The password is typed with insertText, never put into a script, and never logged or returned.
 *
 * Remaining race: between the last check (focus is on the intended field) and insertText running
 * in the page's process, a page script could still move focus. The window is a few milliseconds
 * and the origin is the saved one, so only that site's own scripts could exploit it.
 * After the password is submitted the page may legitimately redirect anywhere (SSO), so polling
 * then is read-only and no longer origin-bound; nothing is typed after that point.
 */
import type { SavedLoginMeta } from "./logins.js";

export interface LoginFillPane {
  getURL(): string;
  /** Runs in an isolated world, so page scripts cannot redefine what the locator calls. */
  runInPage(script: string): Promise<unknown>;
  insertText(text: string): Promise<void>;
  pressEnter(): Promise<void>;
  onNavigate(cb: (url: string) => void): () => void;
}

export interface LoginFillVault {
  list(): Promise<SavedLoginMeta[]>;
  get(id: string): Promise<{ meta: SavedLoginMeta; username: string; password: string }>;
}

export interface FillResult {
  ok: boolean;
  note: string;
}

export const LOGIN_WORLD_ID = 1337;

const NOTE = {
  unknown: "No saved login with that name.",
  origin: "The page is not the saved site. Nothing was filled.",
  otp: "The site asks for a code. Ask the owner to finish signing in.",
  noForm: "No sign-in form on this page.",
  failed: "Sign-in did not go through. Ask the owner to check.",
  done: "Signed in.",
  error: "Filling the login failed. Nothing more was done.",
};

type Field = "username" | "password";
interface Found {
  username: boolean;
  password: boolean;
  otp: boolean;
  active: boolean;
}

/** Name, id and autocomplete of a code field; placeholder and aria-label use the looser PROMPT form. */
export const OTP_ATTRS = /(^|[^a-z])(otp|2fa|mfa|totp)([^a-z]|$)|one.?time|verification.?code|security.?code/i;
export const OTP_PROMPT = /(6|six).?digit|verification.?code|security.?code|one.?time/i;

/** Returns only booleans. With a field name it focuses that field, or with verify only reports focus. Top document only. */
const LOCATOR = `(function (focus, verify) {
  var OTP_ATTRS = ${OTP_ATTRS.toString()};
  var OTP_PROMPT = ${OTP_PROMPT.toString()};
  var USER = /user|login|email|mail/i;
  function visible(el) {
    var r = el.getBoundingClientRect();
    var s = getComputedStyle(el);
    var onscreen = r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
    return r.width > 0 && r.height > 0 && onscreen && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0" && !el.disabled && !el.readOnly;
  }
  function isOtp(el) {
    var ac = el.getAttribute("autocomplete") || "";
    if (ac === "one-time-code") return true;
    return OTP_ATTRS.test(ac + " " + (el.name || "") + " " + (el.id || "")) || OTP_PROMPT.test((el.placeholder || "") + " " + (el.getAttribute("aria-label") || ""));
  }
  var inputs = Array.prototype.slice.call(document.querySelectorAll("input")).filter(visible);
  var pw = inputs.filter(function (e) { return e.type === "password"; })[0] || null;
  var otp = inputs.filter(function (e) { return e.type !== "password" && isOtp(e); })[0] || null;
  var texts = inputs.filter(function (e) { return /^(text|email|tel|)$/.test(e.type) && !isOtp(e); });
  var user = null;
  if (pw) {
    texts.forEach(function (e) { if (e.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING) user = e; });
  } else {
    user = texts.filter(function (e) {
      var ac = e.getAttribute("autocomplete") || "";
      return e.type === "email" || /username|email/.test(ac) || USER.test((e.name || "") + " " + (e.id || ""));
    })[0] || null;
  }
  var target = focus === "username" ? user : focus === "password" ? pw : null;
  if (target && !verify) target.focus();
  return { username: !!user, password: !!pw, otp: !!otp, active: !!target && document.activeElement === target };
})`;

const locatorScript = (focus: Field | null, verify = false) => `${LOCATOR}(${JSON.stringify(focus)}, ${verify})`;

class Stop extends Error {
  readonly note: string;
  constructor(note: string) {
    super(note);
    this.note = note;
  }
}

export function createLoginFill(deps: {
  vault: LoginFillVault;
  pane: LoginFillPane;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const { vault, pane } = deps;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const originOf = (url: string): string | null => {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  };

  async function fillOnce(site: string): Promise<FillResult> {
    const metas = await vault.list();
    const meta = metas.find((m) => m.id === site) ?? metas.find((m) => m.label === site);
    if (!meta) return { ok: false, note: NOTE.unknown };

    let moved = false;
    let submitted = false;
    const stopListening = pane.onNavigate((url) => {
      if (originOf(url) !== meta.origin) moved = true;
    });
    // After the password was submitted the site may redirect anywhere; we only read from then on.
    const guard = () => {
      if (submitted) return;
      if (moved || originOf(pane.getURL()) !== meta.origin) throw new Stop(NOTE.origin);
    };
    // A page that is mid-navigation cannot be scripted; that counts as "not there yet".
    const locate = async (focus: Field | null = null, verify = false): Promise<Found | null> => {
      guard();
      try {
        const r = (await pane.runInPage(locatorScript(focus, verify))) as Partial<Found> | null;
        return r ? { username: r.username === true, password: r.password === true, otp: r.otp === true, active: r.active === true } : null;
      } catch {
        return null;
      }
    };
    const poll = async (until: (f: Found) => boolean): Promise<Found | null> => {
      const deadline = now() + 10_000;
      for (;;) {
        await sleep(300);
        const f = await locate();
        if (f?.otp) throw new Stop(NOTE.otp);
        if (f && until(f)) return f;
        if (now() >= deadline) return null;
      }
    };
    const type = async (field: Field, text: string) => {
      const f = await locate(field);
      if (!f?.[field]) throw new Stop(NOTE.noForm);
      guard();
      // The intended field must hold focus in the top document, or the text would go elsewhere.
      if (!(await locate(field, true))?.active) throw new Stop(NOTE.origin);
      guard();
      await pane.insertText(text);
    };

    try {
      guard();
      const first = await locate();
      if (!first || (!first.username && !first.password)) return { ok: false, note: first?.otp ? NOTE.otp : NOTE.noForm };
      if (first.otp) return { ok: false, note: NOTE.otp };

      const secret = await vault.get(meta.id);
      if (secret.meta.origin !== meta.origin) throw new Stop(NOTE.origin);
      guard();
      if (first.username) await type("username", secret.username);
      if (first.password) {
        await type("password", secret.password);
      } else {
        // Two-step login: submit the username, wait for the password field.
        await pane.pressEnter();
        if (!(await poll((f) => f.password))) return { ok: false, note: NOTE.failed };
        await type("password", secret.password);
      }
      submitted = true;
      await pane.pressEnter();

      const after = await poll((f) => !f.password);
      return after ? { ok: true, note: NOTE.done } : { ok: false, note: NOTE.failed };
    } catch (error) {
      // Only fixed notes leave this function; the original error may mention a secret.
      return { ok: false, note: error instanceof Stop ? error.note : NOTE.error };
    } finally {
      stopListening();
    }
  }

  // One fill at a time: a second call waits for the first.
  let chain: Promise<unknown> = Promise.resolve();
  function fill(site: string): Promise<FillResult> {
    const run = chain.then(() => fillOnce(site));
    chain = run.catch(() => undefined);
    return run;
  }

  return { fill };
}
