/** Pure URL and permission rules for the browser pane and the UI window. */

/** True for http(s) addresses and about:blank; everything else (file:, mailto:, custom schemes) is refused. */
export function isWebUrl(url: string): boolean {
  if (url === "about:blank") return true;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Pane permissions pages may use; every other permission is denied. */
export const allowedPanePermissions: ReadonlySet<string> = new Set(["clipboard-sanitized-write", "fullscreen"]);

export function decidePanePermission(permission: string): boolean {
  return allowedPanePermissions.has(permission);
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.origin !== "null" && left.origin === right.origin;
  } catch {
    return false;
  }
}
