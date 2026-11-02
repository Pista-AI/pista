import type { BrowserFrame } from "@pista/protocol";

/** The `src` of the live-view image for one frame. */
export function frameSrc(frame: BrowserFrame): string {
  return `data:image/jpeg;base64,${frame.data}`;
}

/** Short label for the header: the page title, else the host of the address. */
export function frameLabel(frame: Pick<BrowserFrame, "url" | "title">): string {
  if (frame.title) return frame.title;
  try {
    return new URL(frame.url).host || frame.url;
  } catch {
    return frame.url;
  }
}
