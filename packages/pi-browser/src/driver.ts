/**
 * The minimal surface the browser tools need from a browser. Everything higher level
 * (snapshots, refs, clicking by ref) is built on these primitives in actions.ts, so a new
 * browser only needs a driver: the app's built-in pane, plain Chromium over CDP, etc.
 */

export interface PageState {
  url: string;
  title: string;
  loading: boolean;
  /** Explanation when the page failed to load or can't be scripted. */
  note?: string;
}

/** Trusted input injected like a real user's (coordinates in CSS px of the viewport). */
export type NativeInput =
  | { type: "click"; x: number; y: number }
  | { type: "text"; text: string }
  | { type: "key"; key: string };

/** Same shape as `SavedLoginMeta` in @pista/protocol. */
export interface SavedLoginMeta {
  id: string;
  label: string;
  origin: string;
  username?: string;
}

export interface BrowserDriver {
  navigate(url: string): Promise<PageState>;
  state(): Promise<PageState>;
  back(): Promise<void>;
  reload(): Promise<void>;
  /** Evaluates a script in the page and returns its JSON-serializable completion value. Throws when the page can't be scripted. */
  evaluate(script: string): Promise<unknown>;
  /** Resolves false when trusted input isn't available; callers then fall back to DOM events. */
  input(event: NativeInput): Promise<boolean>;
  screenshot(): Promise<{ data: string; mimeType: string }>;
  /**
   * Optional: saves one download straight to `path` (absolute) without the bytes passing through the caller. Either `url` is
   * downloaded with the browser's own session, or `trigger` runs (e.g. a click) while the browser waits for the download it causes.
   * Rejects with a plain-language message when none starts or it fails. Drivers without file access leave it out.
   */
  download?(opts: { path: string; url?: string; trigger?: () => Promise<unknown> }): Promise<{ bytes: number; contentType?: string; urlChain?: string[] }>;
  /** Optional: the owner's saved logins (names and sites only, never secrets). Drivers without a vault leave it out. */
  loginList?(): Promise<SavedLoginMeta[]>;
  /** Optional: signs in to the current page with the saved login `site` (id or label). The desktop app types the secret; it never passes through here. */
  loginFill?(site: string): Promise<{ ok: boolean; note: string }>;
  /** Optional: what the agent is doing, for drivers that show it to the user. */
  setActivity?(label: string): void;
  /** Optional: protocol round trips so far, for per-step traces. Drivers that don't count leave it out. */
  stats?(): { roundTrips: number };
}
