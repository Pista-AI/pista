import { create } from "zustand";
import type { BrowserAction, BrowserResult } from "@pista/protocol";
import type { DesktopBrowserBridge } from "./bridge.ts";
import { host } from "../lib/host.ts";

export interface WebTab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  history: string[];
  cursor: number;
  /** Bumped to force the iframe to reload. */
  nonce: number;
  /** Last failed load (native shell only; iframes show the browser's own error page). */
  error?: { code: number; description: string; url: string };
}

export interface BrowserState {
  tabs: Record<string, WebTab>;
  /** Web tab the agent acts on: the most recently focused one. */
  focusedId: string | null;
  native: boolean;
  /** Last action the agent performed, shown as a badge over the page. */
  agentActivity?: string;
  /** Temporary explanation shown over a tab, e.g. when a site refuses embedding. */
  notice?: { tabId: string; message: string; url?: string };
}

export const useBrowser = create<BrowserState>(() => ({
  tabs: {},
  focusedId: null,
  native: Boolean(window.pistaDesktop?.browser),
}));

const set = useBrowser.setState;
const get = useBrowser.getState;

let tabSeq = 0;
let activityTimer: ReturnType<typeof setTimeout> | undefined;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export function showNotice(tabId: string, message: string, url?: string) {
  clearTimeout(noticeTimer);
  set({ notice: { tabId, message, url } });
  noticeTimer = setTimeout(() => set({ notice: undefined }), 8000);
}

export function dismissNotice() {
  clearTimeout(noticeTimer);
  set({ notice: undefined });
}

function patchTab(id: string, patch: Partial<WebTab>) {
  set((s) => (s.tabs[id] ? { tabs: { ...s.tabs, [id]: { ...s.tabs[id], ...patch } } } : {}));
}

export function hostLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.host || url;
  } catch {
    return url;
  }
}

/**
 * Drives the browser surface: the desktop shell's native view when present, otherwise one
 * <iframe> per tab. Agent tool calls arrive through `handleAgentRequest` and act on the
 * focused web tab.
 */
class BrowserController {
  private iframes = new Map<string, HTMLIFrameElement>();
  baseUrl = "";
  /** Set by the panel so the controller can open a tab when the agent needs one. */
  onNeedTab?: (url: string) => string;

  private get native(): DesktopBrowserBridge | undefined {
    return window.pistaDesktop?.browser;
  }

  constructor() {
    this.native?.onState((s) => {
      const id = get().focusedId;
      if (id) patchTab(id, { url: s.error?.url || s.url, title: s.title, loading: s.loading, error: s.error });
    });
  }

  createTab(input?: string): string {
    const id = `web-${++tabSeq}`;
    const url = this.resolve(input ?? this.baseUrl);
    set((s) => ({
      tabs: { ...s.tabs, [id]: { id, url, title: "", loading: true, history: [url], cursor: 0, nonce: 0 } },
      focusedId: id,
    }));
    if (this.native) void this.native.navigate(url);
    else void this.checkEmbeddable(id, url);
    return id;
  }

  closeTab(id: string) {
    this.iframes.delete(id);
    set((s) => {
      const { [id]: _, ...rest } = s.tabs;
      return { tabs: rest, focusedId: s.focusedId === id ? (Object.keys(rest).at(-1) ?? null) : s.focusedId };
    });
  }

  focus(id: string) {
    if (get().focusedId === id) return;
    set({ focusedId: id });
    const tab = get().tabs[id];
    if (this.native && tab) void this.native.navigate(tab.url);
  }

  attachIframe(id: string, el: HTMLIFrameElement | null) {
    if (el) this.iframes.set(id, el);
    else this.iframes.delete(id);
  }

  resolve(input: string): string {
    const value = input.trim();
    if (!value) return this.baseUrl;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
    if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(value) || value.startsWith("localhost")) return `http://${value}`;
    return new URL(value, this.baseUrl || window.location.origin).toString();
  }

  async navigate(id: string, input: string) {
    const url = this.resolve(input);
    const tab = get().tabs[id];
    if (!tab) return;
    const history = [...tab.history.slice(0, tab.cursor + 1), url];
    patchTab(id, { url, title: "", loading: true, history, cursor: history.length - 1, error: undefined });
    if (get().notice?.tabId === id) dismissNotice();
    if (this.native) await this.native.navigate(url);
    else void this.checkEmbeddable(id, url);
  }

  /** The iframe can't tell us a site refused framing, so ask the host to check the headers. */
  private async checkEmbeddable(id: string, url: string) {
    if (new URL(url, window.location.href).origin === window.location.origin) return;
    try {
      const { embeddable } = await host.call("browser.probe", { url });
      if (!embeddable && get().tabs[id]?.url === url) {
        showNotice(id, `${hostLabel(url)} can't be shown in the web preview.`, url);
      }
    } catch {
      /* host unreachable: the iframe shows its own error */
    }
  }

  async back(id: string) {
    if (this.native) return this.native.back();
    const tab = get().tabs[id];
    if (!tab || tab.cursor <= 0) return;
    patchTab(id, { cursor: tab.cursor - 1, url: tab.history[tab.cursor - 1], loading: true });
  }

  async forward(id: string) {
    if (this.native) return this.native.forward();
    const tab = get().tabs[id];
    if (!tab || tab.cursor >= tab.history.length - 1) return;
    patchTab(id, { cursor: tab.cursor + 1, url: tab.history[tab.cursor + 1], loading: true });
  }

  async reload(id: string) {
    if (this.native) return this.native.reload();
    const tab = get().tabs[id];
    if (tab) patchTab(id, { nonce: tab.nonce + 1, loading: true });
  }

  /** Called by the iframe's onLoad. Same-origin pages expose their real location and title. */
  onIframeLoad(id: string) {
    const doc = this.sameOriginDocument(id);
    patchTab(id, {
      loading: false,
      ...(doc ? { title: doc.title, url: this.iframes.get(id)?.contentWindow?.location.href ?? get().tabs[id]?.url } : {}),
    });
  }

  private sameOriginDocument(id: string): Document | null {
    try {
      return this.iframes.get(id)?.contentDocument ?? null;
    } catch {
      return null;
    }
  }

  private crossOriginNote =
    "This page is cross-origin inside the web build's iframe, so its content is not readable. Run Pista in the desktop shell for full browser access.";

  /**
   * Browser primitives from the host's driver (@pista/pi-browser builds snapshots and
   * ref-based actions on top). Failures throw, so the host sees them as tool errors.
   */
  async handleAgentRequest(req: BrowserAction): Promise<BrowserResult> {
    if (req.activity) {
      clearTimeout(activityTimer);
      set({ agentActivity: req.activity });
      activityTimer = setTimeout(() => set({ agentActivity: undefined }), 2500);
    }

    let id = get().focusedId;
    if (!id || !get().tabs[id]) {
      id = this.onNeedTab?.(req.action === "navigate" ? req.url : this.baseUrl) ?? this.createTab(req.action === "navigate" ? req.url : undefined);
      if (req.action === "navigate") {
        await this.waitForLoad(id);
        return this.native ? this.nativeState(this.native) : this.stateOf(id);
      }
    }
    if (this.native) return this.handleNative(this.native, id, req);

    switch (req.action) {
      case "navigate":
        await this.navigate(id, req.url);
        await this.waitForLoad(id);
        return { ...this.stateOf(id), note: this.sameOriginDocument(id) ? undefined : "Loaded in iframe; content is cross-origin." };
      case "state":
        return this.stateOf(id);
      case "back":
        await this.back(id);
        return this.stateOf(id);
      case "reload":
        await this.reload(id);
        return this.stateOf(id);
      case "screenshot":
        showNotice(id, "The agent can't take screenshots in the web preview.");
        throw new Error("Screenshots need the desktop shell (native webview capture).");
      case "input":
        // No trusted input in an iframe; the driver falls back to DOM events.
        return { ...this.stateOf(id), value: false };
      case "eval": {
        const win = this.iframes.get(id)?.contentWindow as (Window & { eval(s: string): unknown }) | null | undefined;
        if (!this.sameOriginDocument(id) || !win) {
          showNotice(id, `The agent can't read ${hostLabel(get().tabs[id]?.url ?? "")} in the web preview.`);
          throw new Error(this.crossOriginNote);
        }
        return { ...this.stateOf(id), value: serialize(await win.eval(req.script)) };
      }
    }
  }

  private stateOf(id: string): BrowserResult {
    const tab = get().tabs[id];
    return { url: tab?.url, title: tab?.title, loading: Boolean(tab?.loading) };
  }

  private async nativeState(b: DesktopBrowserBridge): Promise<BrowserResult> {
    const s = await b.state();
    return s.error
      ? { url: s.error.url, title: s.title, loading: s.loading, note: `Page failed to load: ${s.error.description}. ${loadErrorHint(s.error.description)}` }
      : { url: s.url, title: s.title, loading: s.loading };
  }

  private async handleNative(b: DesktopBrowserBridge, id: string, req: BrowserAction): Promise<BrowserResult> {
    switch (req.action) {
      case "navigate":
        await this.navigate(id, req.url);
        return this.nativeState(b);
      case "state":
        return this.nativeState(b);
      case "back":
        await b.back();
        return this.nativeState(b);
      case "reload":
        await b.reload();
        return this.nativeState(b);
      case "screenshot":
        return { ...(await this.nativeState(b)), image: await b.screenshot() };
      case "input":
        // Shells without trusted input (older builds) report false; the driver falls back to DOM events.
        return { value: b.input ? await b.input(req.event) : false };
      case "eval":
        return { value: serialize(await b.evaluate(req.script)) };
    }
  }

  private waitForLoad(id: string, timeout = 15000): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => (!get().tabs[id]?.loading || Date.now() - start > timeout ? resolve() : setTimeout(tick, 100));
      setTimeout(tick, 50);
    });
  }
}

/** Plain-language explanation for common Chromium network errors. */
export function loadErrorHint(description: string): string {
  if (/NAME_NOT_RESOLVED|NAME_RESOLUTION/.test(description)) return "The address couldn't be found. Check the spelling of the domain.";
  if (/CONNECTION_REFUSED/.test(description)) return "Nothing is running at this address. If it's a local server, start it and retry.";
  if (/INTERNET_DISCONNECTED|NETWORK_CHANGED/.test(description)) return "You appear to be offline.";
  if (/TIMED_OUT|CONNECTION_TIMED_OUT/.test(description)) return "The server took too long to respond.";
  if (/CERT|SSL/.test(description)) return "The site's security certificate isn't valid.";
  return "The page couldn't be loaded.";
}

function serialize(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return String(value);
  }
}

export const browser = new BrowserController();
