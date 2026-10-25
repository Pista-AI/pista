import type { LinkTarget } from "@pista/protocol";
import { actions, useApp } from "./store.ts";

/** Always the user's system browser (sign-in flows, explicit "open externally" buttons). */
export function openExternal(url: string) {
  (window.pistaDesktop?.openExternal ?? ((u: string) => window.open(u, "_blank", "noopener")))(url);
}

function isHomeSite(url: string): boolean {
  const web = useApp.getState().config?.homeUrl;
  try {
    return Boolean(web) && new URL(url).origin === new URL(web!).origin;
  } catch {
    return false;
  }
}

function opensInApp(url: string, target: LinkTarget): boolean {
  if (target === "builtin") return true;
  if (target === "external") return false;
  return isHomeSite(url);
}

/**
 * Opens a link according to Settings → General → "Open links in".
 * `invert` (⌘/Ctrl-click) sends it the other way for that one click.
 */
export function openLink(url: string, invert = false) {
  if (!/^https?:\/\//i.test(url)) return openExternal(url);
  const target = useApp.getState().config?.linkTarget ?? "builtin";
  if (opensInApp(url, target) !== invert) actions.newWebTab(url);
  else openExternal(url);
}
