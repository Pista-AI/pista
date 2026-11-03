import type { BrowserDriver, DocumentProbe } from "./driver.ts";
import { scripts } from "./page-scripts.ts";

/** Pages of the browser itself. `chrome-error:` (a failed load) and `about:blank` are not among them. */
const INTERNAL_PROTOCOLS = new Set(["chrome:", "chrome-extension:", "chrome-untrusted:", "chrome-search:", "chrome-native:", "devtools:", "view-source:", "edge:", "brave:", "about:"]);
const SAVED_LOGIN_TTL_MS = 60_000;

/** Why the agent may not open or use `url` (a page of the browser itself), or undefined. */
export function internalPageReason(url: string): string | undefined {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return undefined;
  }
  if (!INTERNAL_PROTOCOLS.has(protocol) || url === "about:blank") return undefined;
  return `${protocol} pages are part of the browser itself and are off limits to the agent.`;
}

const EVAL_REFUSED = "browser_eval is disabled on this page";
const OTHER_TOOLS = "Use browser_snapshot, browser_read, browser_click and browser_type instead.";

/** Scheme and port do not matter for a login; hosts do. Without a public-suffix list: the last two labels, three under country-code second levels like co.uk. */
export function siteOf(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.+$/, "");
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

  private async probe(d: BrowserDriver): Promise<DocumentProbe> {
    if (d.probe) return d.probe();
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
    this.saved = { at: this.now(), sites: new Set(origins.map(siteOf)) };
    return this.saved.sites;
  }

  /** Throws when a script may not run on the current page; otherwise marks the document as one a script runs in. */
  async beforeEval(d: BrowserDriver): Promise<void> {
    const p = await this.probe(d);
    const internal = internalPageReason(p.url);
    if (internal) throw new Error(`${EVAL_REFUSED}: ${internal}`);
    const origin = originOf(p.url);
    if (p.secret) this.blocked.add(origin);
    if (this.blocked.has(origin)) throw new Error(`${EVAL_REFUSED}: a sign-in form was seen on ${origin}, so scripts stay off there for the rest of this chat. ${OTHER_TOOLS}`);
    let sites: Set<string>;
    try {
      sites = await this.savedSites(d);
    } catch {
      throw new Error(`${EVAL_REFUSED}: the list of sites with saved logins could not be read. ${OTHER_TOOLS}`);
    }
    if (sites.has(siteOf(p.url))) throw new Error(`browser_eval is disabled on sites with saved logins (${siteOf(p.url)}). ${OTHER_TOOLS}`);
    this.tainted.add(p.documentId);
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
  async afterAction(d: BrowserDriver): Promise<string | undefined> {
    if (!d.probe) return undefined;
    const p = await this.probe(d);
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
    const p = await this.probe(d);
    if (p.secret) this.blocked.add(originOf(p.url));
    if (!this.tainted.has(p.documentId)) return undefined;
    // A script-free-looking page keeps its form state: only a page that has, or is on a site with, a sign-in is reloaded.
    let login = p.secret;
    if (!login) {
      try {
        login = (await this.savedSites(d)).has(siteOf(p.url));
      } catch {
        login = true; // unknown counts as saved
      }
    }
    if (!login) return undefined;
    await d.reload();
    return "The page was reloaded first, because a script had run in it and it has a sign-in.";
  }
}

const gates = new WeakMap<BrowserDriver, EvalGate>();
export const gateFor = (d: BrowserDriver) => gates.get(d) ?? (gates.set(d, new EvalGate()), gates.get(d)!);
