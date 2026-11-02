/**
 * Content-Security-Policy for the UI window. The UI page can reach the preload bridge (saved logins,
 * browser evaluate, download arming), so script injection there must not run. The browser pane is a
 * separate session and is never given this policy.
 */

/** The WebSocket origin that matches an http(s) origin, e.g. http://127.0.0.1:4317 -> ws://127.0.0.1:4317. */
function socketOrigin(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}`;
}

/**
 * `uiUrl` is the address the window loads (the host in packaged builds, the Vite server in dev).
 * Every directive that is not listed falls back to `default-src 'self'`.
 */
export function buildUiCsp(uiUrl: string, opts: { dev: boolean }): string {
  const origin = new URL(uiUrl).origin;
  const policy: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Only the bundled module script; no inline code, no eval.
    "script-src": ["'self'"],
    "style-src": ["'self'"],
    // Pane screenshots and tool-result images arrive as data: URLs.
    "img-src": ["'self'", "data:"],
    "font-src": ["'self'", "data:"],
    // The one WebSocket to the host (same origin as the page); 'self' alone does not cover ws: in every engine version.
    "connect-src": ["'self'", socketOrigin(origin)],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'none'"],
  };
  if (opts.dev) {
    // Dev only: Vite's React plugin injects an inline preamble script and its CSS HMR injects <style> tags,
    // and HMR pings the dev server over http. None of this applies to a packaged build.
    policy["script-src"].push("'unsafe-inline'");
    policy["style-src"].push("'unsafe-inline'");
    policy["connect-src"].push(origin);
  }
  return Object.entries(policy)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}
