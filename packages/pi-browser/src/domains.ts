/**
 * Managed domain rules for the browser tools. `guardDriver` wraps any BrowserDriver, so the rules hold for every driver.
 * Matching runs on the parsed URL hostname (lower case, punycode by the URL parser, trailing dots stripped), never on the raw string:
 * `https://allowed.com@evil.com/` and `https://evil.com\@allowed.com` both have the host evil.com.
 */
import type { BrowserDriver, PageState } from "./driver.ts";

export interface DomainRules {
  /** When set, only these hosts may be opened. Entries: an exact host, or `*.example.com` (subdomains only, not example.com itself). */
  allowedDomains?: string[];
  /** These hosts are refused, also when allowed. Same entry format. */
  deniedDomains?: string[];
}

const stripDots = (host: string) => host.replace(/\.+$/, "");
const isIp = (host: string) => host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host);

/** Canonical form of one entry (`*.` prefix kept), or null when it is not a plain host pattern. No regex, no ports, paths or credentials. */
export function normalizeDomainPattern(pattern: string): string | null {
  const trimmed = pattern.trim();
  const wildcard = trimmed.startsWith("*.");
  const rest = (wildcard ? trimmed.slice(2) : trimmed).toLowerCase();
  if (!rest || /[\s/\\@*?#%]/.test(rest) || (/:/.test(rest) && !/^\[[0-9a-f:.]+\]$/.test(rest))) return null;
  try {
    const host = stripDots(new URL(`http://${rest}`).hostname);
    if (!host || (wildcard && isIp(host))) return null;
    return wildcard ? `*.${host}` : host;
  } catch {
    return null;
  }
}

function hostMatches(host: string, pattern: string): boolean {
  if (!pattern.startsWith("*.")) return host === pattern;
  return !isIp(host) && host.endsWith(pattern.slice(1)); // ".example.com": the apex does not match
}

/** Why `url` may not be opened, or undefined when it may. Deny wins; an allowlist denies everything else; once any rule is set only http(s) and inert blank pages pass. */
export function checkUrl(url: string, rules: DomainRules): string | undefined {
  if (!rules.allowedDomains && !rules.deniedDomains?.length) return undefined;
  if (url === "" || url === "about:blank") return undefined; // guardDriver treats "" as unsettled, never as safe
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "it is not a full http(s) URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return `${parsed.protocol} pages are not allowed`;
  const host = stripDots(parsed.hostname);
  if (rules.deniedDomains?.some((p) => hostMatches(host, p))) return `${host} is on the denied list`;
  if (rules.allowedDomains && !rules.allowedDomains.some((p) => hostMatches(host, p))) return `${host} is not on the allowed list`;
  return undefined;
}

const ERROR_PAGE = "chrome-error://chromewebdata/";
const EMPTY_RETRIES = 5;
const EMPTY_RETRY_MS = 100;

export class DomainBlockedError extends Error {
  constructor(readonly reason: string, readonly reset = false) {
    super(`Blocked by your organization's policy: ${reason}.${reset ? " The browser was reset to a blank page." : ""} Do not try another way to open it; tell the user.`);
    this.name = "DomainBlockedError";
  }
}

/** Refuses blocked URLs before navigating, and checks where the browser ended up (redirects, clicks, history) whenever the tools read its state; a blocked page is replaced by about:blank. */
export function guardDriver(inner: BrowserDriver, rules: DomainRules, onBlock?: (reason: string) => void): BrowserDriver {
  const refuse = (reason: string, reset: boolean): never => {
    onBlock?.(reason);
    throw new DomainBlockedError(reason, reset);
  };
  const reset = async (reason: string): Promise<never> => {
    await inner.navigate("about:blank").catch(() => undefined);
    return refuse(reason, true);
  };
  // An empty URL means the driver could not read the page (mid-navigation): poll briefly, then fail closed.
  const settle = async (state: PageState): Promise<PageState> => {
    for (let i = 0; state.url === "" && i < EMPTY_RETRIES; i++) {
      await new Promise((r) => setTimeout(r, EMPTY_RETRY_MS));
      state = await inner.state();
    }
    if (state.url === "") return reset("the page address could not be verified");
    if (state.url === ERROR_PAGE) return state;
    const reason = checkUrl(state.url, rules);
    return reason ? reset(reason) : state;
  };
  const check = async () => void (await settle(await inner.state()));
  return {
    navigate: async (url) => {
      const reason = url.startsWith("chrome-error:") ? "chrome-error pages are not allowed" : checkUrl(url, rules);
      if (reason) refuse(reason, false);
      return settle(await inner.navigate(url));
    },
    state: async () => settle(await inner.state()),
    back: async () => {
      await check();
      await inner.back();
      await check();
    },
    reload: async () => {
      await check();
      await inner.reload();
      await check();
    },
    evaluate: async (script) => (await check(), inner.evaluate(script)),
    input: async (event) => (await check(), inner.input(event)),
    screenshot: async () => (await check(), inner.screenshot()),
    download: inner.download
      ? async (opts) => {
          const reason = opts.url ? checkUrl(opts.url, rules) : undefined;
          if (reason) refuse(reason, false);
          await check();
          return inner.download!(opts);
        }
      : undefined,
    setActivity: inner.setActivity?.bind(inner),
    stats: inner.stats?.bind(inner),
  };
}
