import { randomUUID } from "node:crypto";
import type { BrowserDriver, DocumentProbe, ProbeOptions } from "./driver.ts";
import { scripts } from "./page-scripts.ts";

/** Pages of the browser itself. `chrome-error:` (a failed load) and `about:blank` are not among them. */
const INTERNAL_PROTOCOLS = new Set(["chrome:", "chrome-extension:", "chrome-untrusted:", "chrome-search:", "chrome-native:", "devtools:", "view-source:", "edge:", "brave:", "about:", "javascript:"]);
const SAVED_LOGIN_TTL_MS = 10_000;

/** Why the agent may not open or use `url` (a page of the browser itself), or undefined. */
export function internalPageReason(url: string): string | undefined {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return undefined;
  }
  if (!INTERNAL_PROTOCOLS.has(protocol) || url === "about:blank") return undefined;
  return `${protocol} addresses are off limits to the agent (browser-internal pages and script URLs).`;
}

const EVAL_REFUSED = "browser_eval is disabled on this page";
const OTHER_TOOLS = "Use browser_snapshot, browser_read, browser_click and browser_type instead.";

/** Scheme and port do not matter for a login; hosts do. Without a public-suffix list: the last two labels, three under country-code second levels like co.uk. */
export function registrableSite(url: string): string {
  let host: string;
  try {
    const origin = new URL(url).origin; // blob: and filesystem: URLs carry their creator's origin
    host = new URL(origin === "null" ? url : origin).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return url;
  }
  if (host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const labels = host.split(".");
  const three = labels.length > 2 && labels.at(-1)!.length === 2 && /^(?:co|com|org|net|gov|ac|edu|ne|or)$/.test(labels.at(-2)!);
  return labels.slice(three ? -3 : -2).join(".");
}

const originOf = (url: string) => {
  try {
    const o = new URL(url).origin;
    return o === "null" ? url : o;
  } catch {
    return url;
  }
};

/**
 * Keeps `browser_eval` away from every place a password can be, so a script (planted by a page) cannot copy one into text the
 * model reads. One gate per driver, kept for the life of the driver:
 * - sites with a saved login (the browser's password manager, the vault) never get a script;
 * - an origin where a password field was seen never gets one again;
 * - a document a script ran in is reloaded, planted code gone, when a password field appears in it later, and before the user is handed the browser if it has a password field or is a saved-login site.
 */
export class EvalGate {
  private blocked = new Set<string>();
  private tainted = new Set<string>();
  private saved: { at: number; sites: Set<string> } | undefined;

  constructor(private now: () => number = Date.now) {}

  private async probe(d: BrowserDriver, opts?: ProbeOptions): Promise<DocumentProbe> {
    if (d.probe) return d.probe(opts);
    // Main-world fallback for drivers that cannot make an isolated world (the embedded pane); page code could in principle tamper with it.
    const r = (await d.evaluate(scripts.hasPassword())) as unknown;
    const state = await d.state();
    if (typeof r !== "boolean") throw new Error("The page could not be checked for password fields.");
    const time = (await d.evaluate("String(performance.timeOrigin)").catch(() => "")) as string;
    return { url: state.url, documentId: `${state.url}#${time}`, secret: r };
  }

  private async savedSites(d: BrowserDriver): Promise<Set<string>> {
    if (this.saved && this.now() - this.saved.at < SAVED_LOGIN_TTL_MS) return this.saved.sites;
    const origins = [...((await d.savedLoginOrigins?.()) ?? []), ...((await d.loginList?.()) ?? []).map((l) => l.origin)];
    this.saved = { at: this.now(), sites: new Set(origins.map(registrableSite)) };
    return this.saved.sites;
  }

  /**
   * Throws when a script may not run on the current page; otherwise marks the document as one a script runs in and returns it, with a
   * token written onto that document: the script only starts if it finds the token, so a navigation after this check cannot make it run
   * in another document. Drivers without an isolated world get no token.
   */
  async beforeEval(d: BrowserDriver): Promise<{ documentId: string; token?: string }> {
    const token = d.probe ? randomUUID() : undefined;
    try {
      const p = await this.probe(d, { token });
      const internal = internalPageReason(p.url);
      if (internal) throw new Error(`${EVAL_REFUSED}: ${internal}`);
      const origin = originOf(p.url);
      if (!/^https?:\/\//.test(origin)) throw new Error(`${EVAL_REFUSED}: scripts only run on http(s) pages. ${OTHER_TOOLS}`);
      if (p.secret) this.blocked.add(origin);
      if (this.blocked.has(origin)) throw new Error(`${EVAL_REFUSED}: a sign-in form was seen on ${origin}, so scripts stay off there for the rest of this chat. ${OTHER_TOOLS}`);
      if (await this.isSavedSite(d, p.url)) throw new Error(`browser_eval is disabled on sites with saved logins (${registrableSite(p.url)}). ${OTHER_TOOLS}`);
      this.tainted.add(p.documentId);
      return { documentId: p.documentId, token };
    } catch (error) {
      if (token) await d.probe!({ clearToken: true }).catch(() => undefined);
      throw error;
    }
  }

  /** Whether `url` is on a site with a saved login; a list that cannot be read counts as yes. */
  private async isSavedSite(d: BrowserDriver, url: string): Promise<boolean> {
    try {
      return (await this.savedSites(d)).has(registrableSite(url));
    } catch {
      return true;
    }
  }

  /** Refuses any action on a browser-internal page. */
  async beforeAction(d: BrowserDriver): Promise<void> {
    if (!d.probe) return;
    const reason = internalPageReason((await this.probe(d)).url);
    if (reason) throw new Error(`${reason} Open a website with browser_navigate.`);
  }

  /**
   * Runs after a tool did its work and before its result is returned. Returns a note, and the caller must then drop what the tool
   * read, when the page was replaced: a password field showed up in a document a script ran in (reloaded), or the tab sits on a browser page (blanked).
   */
  async afterAction(d: BrowserDriver, evalDocument?: string): Promise<string | undefined> {
    if (!d.probe) return undefined;
    const p = await this.probe(d, evalDocument ? { clearToken: true } : undefined);
    // The page changed while a script was starting (a redirect): the script was pinned to the old document and ran nowhere else,
    // but the new one is treated as one a script ran in. Whatever came back is dropped.
    if (evalDocument && p.documentId !== evalDocument) {
      this.tainted.add(p.documentId);
      if (p.secret) this.blocked.add(originOf(p.url));
      if (internalPageReason(p.url)) await d.navigate("about:blank");
      else if (p.secret || (await this.isSavedSite(d, p.url))) await d.reload();
      return "The page navigated while the script was starting, so nothing was returned (the script did not run in the new page). Check where you are with browser_read and try again.";
    }
    if (p.secret) this.blocked.add(originOf(p.url));
    if (internalPageReason(p.url)) {
      await d.navigate("about:blank");
      return "The tab was on a browser-internal page, which is off limits. It was reset to a blank page.";
    }
    if (p.secret && this.tainted.has(p.documentId)) {
      await d.reload();
      return "The page was reloaded because a sign-in form appeared after a script had run in it. What it showed was discarded, and browser_eval stays off on this site.";
    }
    return undefined;
  }

  /** Before the browser goes to the user: a document a script ran in is reloaded, so nothing planted sees what they type. */
  async beforeHandoff(d: BrowserDriver): Promise<string | undefined> {
    this.saved = undefined;
    const p = await this.probe(d);
    if (p.secret) this.blocked.add(originOf(p.url));
    if (!this.tainted.has(p.documentId)) return undefined;
    await d.reload();
    return "The page was reloaded first, because a script had run in it (anything typed there earlier is gone).";
  }
}

const gates = new WeakMap<BrowserDriver, EvalGate>();
export const gateFor = (d: BrowserDriver) => gates.get(d) ?? (gates.set(d, new EvalGate()), gates.get(d)!);
