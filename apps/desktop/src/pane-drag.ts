import type { WebContents } from "electron";

/**
 * Forces `app-region: no-drag` on every element of every page shown in the browser pane.
 *
 * Electron applies a WebContentsView page's `-webkit-app-region: drag` rects to the window's
 * drag map and keeps the last reported rects after the view navigates to a page that declares
 * no app-region at all (electron/electron#54743), because such a page never reports an update.
 * A page that once had a draggable header would leave a dead band at the top of every later
 * page in the tab. Pages in the pane must never drag the Pista window anyway, and annotating
 * the `html` element makes every document report a region update, which resets the stale rects.
 *
 * `cssOrigin: "user"` is required so the `!important` rules beat `!important` rules in the page.
 */
export const PANE_NO_DRAG_CSS =
  "html, html * { -webkit-app-region: no-drag !important; app-region: no-drag !important; }";

export function neutralizePaneDragRegions(wc: Pick<WebContents, "on" | "insertCSS">): void {
  wc.on("dom-ready", () => {
    void wc.insertCSS(PANE_NO_DRAG_CSS, { cssOrigin: "user" }).catch(() => {});
  });
}
