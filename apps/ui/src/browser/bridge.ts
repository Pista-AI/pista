import type { SavedLoginMeta } from "@pista/protocol";

/**
 * Contract a desktop shell (Electron or Tauri 2) implements to give the UI a real,
 * native browser surface. The web build falls back to an <iframe>, which cannot
 * read cross-origin pages, take screenshots or bypass frame-ancestors headers.
 *
 * Electron: implement with a WebContentsView positioned over `setBounds()` and
 * expose it from the preload script via contextBridge as `window.pistaDesktop`.
 * Tauri 2: implement with a child Webview (`Webview::new` / `add_child`) and
 * forward these calls through `invoke()` commands.
 */
export interface NativeBrowserState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Set when the last main-frame load failed (e.g. ERR_NAME_NOT_RESOLVED). */
  error?: { code: number; description: string; url: string };
}

/** Trusted input the shell injects like a real user would (coordinates in CSS px of the view). */
export type NativeInput =
  | { type: "click"; x: number; y: number }
  | { type: "text"; text: string }
  | { type: "key"; key: string };

export interface DesktopBrowserBridge {
  /** Show the native view over this rectangle (CSS pixels, relative to the window). */
  setBounds(rect: { x: number; y: number; width: number; height: number } | null): void;
  navigate(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  state(): Promise<NativeBrowserState>;
  onState(listener: (state: NativeBrowserState) => void): () => void;
  readText(maxChars: number): Promise<string>;
  screenshot(): Promise<{ data: string; mimeType: string }>;
  evaluate(script: string): Promise<unknown>;
  /** One-shot download hook: the next download saves at `path`, which must stay inside the project folder `root` (the shell refuses anything else); with `url` the pane starts it with its own session. */
  armDownload?(path: string, root: string, url?: string): Promise<void>;
  /** Resolves when the armed download completed; rejects when none started within 15 s or it failed. */
  waitDownload?(): Promise<{ bytes: number; contentType?: string; url?: string; urlChain?: string[] }>;
  /** Resolves false when the input couldn't be delivered (e.g. the view is hidden); callers fall back to DOM events. */
  input?(event: NativeInput): Promise<boolean>;
  openDevTools?(): void;
  /** Saved logins live in the desktop main process; only metadata comes back, `fill` never returns the password. */
  logins?: {
    status(): Promise<{ available: boolean; backend: string; presence?: "touchid" | "unavailable" }>;
    list(): Promise<SavedLoginMeta[]>;
    /** The password passes through the renderer only at save time, straight to the main process, and is never part of any protocol message. */
    save(input: { label: string; loginUrl: string; username: string; password: string }): Promise<SavedLoginMeta>;
    remove(id: string): Promise<void>;
    fill(site: string): Promise<{ ok: boolean; note: string }>;
    /** Opens a file dialog in the main process, which reads and imports the CSV. Only counts come back, never rows. */
    import(opts: { trash: boolean }): Promise<LoginImportResult>;
  };
}

export interface LoginImportResult {
  imported: number;
  replaced: number;
  skipped: number;
  failed: number;
  canceled?: true;
  trashed?: boolean;
}

export interface PistaDesktop {
  shell: "electron" | "tauri";
  /** Base URL of the agent host sidecar the shell started, e.g. http://127.0.0.1:4317 */
  hostUrl?: string;
  browser?: DesktopBrowserBridge;
  openExternal?(url: string): void;
  pickFolder?(): Promise<string | null>;
}

declare global {
  interface Window {
    pistaDesktop?: PistaDesktop;
  }
}
