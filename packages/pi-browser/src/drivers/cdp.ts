import type { CdpEvent, CdpTransport } from "../chrome/pipe.ts";
import type { BrowserDriver, DocumentProbe, NativeInput, PageState, ProbeOptions, TabInfo } from "../driver.ts";
import { scripts } from "../page-scripts.ts";

/** The existing DevTools-over-WebSocket connection to one page target, as a transport. */
class WebSocketTransport implements CdpTransport {
  private seq = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private eventHandlers: ((event: CdpEvent) => void)[] = [];
  private closeHandlers: ((error: Error) => void)[] = [];

  constructor(private ws: WebSocket) {
    ws.onmessage = (message) => {
      const msg = JSON.parse(String(message.data));
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p?.reject(new Error(msg.error.message));
        else p?.resolve(msg.result);
      } else if (msg.method) for (const h of this.eventHandlers) h({ method: msg.method, params: msg.params });
    };
    ws.onclose = () => {
      const error = new Error("Browser connection closed");
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear();
      for (const h of this.closeHandlers.splice(0)) h(error);
    };
  }

  send(method: string, params: object = {}): Promise<any> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  onEvent(handler: (event: CdpEvent) => void) {
    this.eventHandlers.push(handler);
  }
  onClose(handler: (error: Error) => void) {
    this.closeHandlers.push(handler);
  }
  close() {
    this.ws.close();
  }
}

/** The connection to the page being driven; `targetId` names the tab so it can be listed and switched back to. */
export type CdpConn = { transport: CdpTransport; sessionId?: string; targetId?: string };
/** A page target of the browser. `openerId` is the target that opened it, when the browser says. */
export type PageTarget = { id: string; url: string; title: string; openerId?: string };

/**
 * Drives one page of a Chromium-based browser over the DevTools Protocol, e.g. Chrome started
 * with `--remote-debugging-port=9222`. Attaches to the first open page (or opens one) and
 * injects trusted input through `Input.*`, so it behaves like the desktop app's pane.
 * The protocol logic runs on any `CdpTransport`: subclasses override `openTransport`.
 */
export class CdpDriver implements BrowserDriver {
  protected conn: CdpConn | undefined;
  private hooked = new WeakSet<CdpTransport>();
  /** A tab counts as opened by the active one only when the browser says so (an unknown opener is not enough). */
  protected strictOpener = false;
  /** Tabs of a browser we do not own that the agent may use (see pageTargets). */
  private known = new Set<string>();
  private adoptedBefore = false;
  private connecting: Promise<void> | undefined;
  private roundTrips = 0;
  protected mainFrameId = "";
  private loading = false;
  private loadError: string | undefined;
  private loadWaiters: (() => void)[] = [];
  /** One isolated world per frame, valid for one document (loaderId) of it. */
  private guardWorlds = new Map<string, { loaderId: string; contextId: number }>();

  constructor(private endpoint = "http://127.0.0.1:9222") {}

  protected connect(): Promise<void> {
    if (this.conn) return Promise.resolve();
    this.connecting ??= this.open().finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  /** The browser's page targets as the DevTools HTTP endpoint lists them (shared by tab listing and attaching). */
  private async jsonList(): Promise<(PageTarget & { type: string; webSocketDebuggerUrl: string })[]> {
    const list = (await (await fetch(`${this.endpoint}/json/list`)).json()) as { id: string; type: string; url: string; title: string; webSocketDebuggerUrl: string }[];
    return list.filter((t) => t.type === "page" && !t.url.startsWith("devtools://"));
  }

  /** Every page target the browser has, newest state. Subclasses that own their browser narrow this to their own tabs. */
  protected async candidateTargets(): Promise<PageTarget[]> {
    return (await this.jsonList()).map((t) => ({ id: t.id, url: t.url, title: t.title }));
  }

  /**
   * The tabs the agent may see and switch to. With a browser we own (strictOpener) that is `candidateTargets()`; with someone else's
   * (a DevTools port) only the page we attached to and tabs that first appeared during one of our own actions, never the user's other tabs.
   */
  protected async pageTargets(): Promise<PageTarget[]> {
    const all = await this.candidateTargets();
    return this.strictOpener ? all : all.filter((t) => this.known.has(t.id));
  }

  /** Connects to the browser and returns the transport plus the session of the page to drive (`targetId` when given, else the first page; none for a per-page WebSocket). */
  protected async openTransport(targetId?: string): Promise<CdpConn> {
    type Target = { id: string; url: string; webSocketDebuggerUrl: string };
    let targets: Target[];
    try {
      targets = await this.jsonList();
    } catch {
      throw new Error(
        `No browser is listening for DevTools connections at ${this.endpoint}. Start Chrome or Chromium with --remote-debugging-port=9222 (and a separate --user-data-dir), or set PI_BROWSER_CDP_URL.`,
      );
    }
    let target = targetId ? targets.find((t) => t.id === targetId) : targets[0];
    if (targetId && !target) throw new Error(`No tab with id ${targetId}.`);
    target ??= (await (await fetch(`${this.endpoint}/json/new?about:blank`, { method: "PUT" })).json()) as Target;
    const ws = new WebSocket(target!.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`Could not connect to ${target!.webSocketDebuggerUrl}`));
    });
    return { transport: new WebSocketTransport(ws), targetId: target!.id };
  }

  /** Runs after the page is enabled and its frame is known; subclasses add their per-page setup here. */
  protected async onAttached(): Promise<void> {}

  private async open() {
    await this.adopt(await this.openTransport());
  }

  /**
   * Makes `next` the page every call acts on: enables it, learns its main frame and runs the subclass setup. Used for the first page and
   * for tab switches. A first page that cannot be set up is dropped (fail closed); a failed switch leaves the previous page in place.
   */
  // Invariants: a failed switch restores `conn` and `mainFrameId` and never closes the previous transport (it is still in use).
  private async adopt(next: CdpConn, switching = false) {
    const prev = this.conn;
    const prevFrame = this.mainFrameId;
    const { transport } = next;
    if (!this.hooked.has(transport)) {
      this.hooked.add(transport);
      transport.onClose(() => {
        if (this.conn?.transport === transport) this.conn = undefined;
      });
      transport.onEvent((event) => {
        if (this.conn?.transport === transport && event.sessionId === this.conn.sessionId) this.onEvent(event);
      });
    }
    this.conn = next;
    this.guardWorlds.clear();
    if (next.targetId) this.known.add(next.targetId);
    try {
      this.loadError = undefined;
      await this.sendRaw("Page.enable");
      const { frameTree } = await this.sendRaw("Page.getFrameTree");
      this.mainFrameId = frameTree.frame.id;
      await this.onAttached();
      // Read once the page is set up (guarded). A page that is mid-load ends with a frameStoppedLoading we will see; one that already
      // finished never sends it again. The very first page is not probed: it is a fresh blank tab.
      const ready = this.adoptedBefore ? await this.sendRaw("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }).catch(() => undefined) : undefined;
      this.loading = ready?.result?.value === "loading" || ready?.result?.value === "interactive";
      this.adoptedBefore = true;
      if (!this.loading) for (const done of this.loadWaiters.splice(0)) done();
    } catch (error) {
      if (switching) {
        this.conn = prev;
        this.mainFrameId = prevFrame;
        if (prev?.transport !== transport) transport.close();
        throw error;
      }
      // Fail closed: a page whose setup failed is never used; the next call retries from scratch.
      this.conn = undefined;
      await this.onAttachFailed(next).catch(() => undefined);
      throw error;
    }
    if (prev && prev.transport !== transport) prev.transport.close();
  }

  async tabs(): Promise<TabInfo[]> {
    await this.connect();
    const active = this.conn?.targetId;
    return (await this.pageTargets()).map((t) => ({ id: t.id, url: t.url, title: t.title, active: t.id === active }));
  }

  async switchTab(id: string): Promise<void> {
    await this.connect();
    if (this.conn?.targetId === id) return;
    if (!(await this.pageTargets()).some((t) => t.id === id)) throw new Error(`No tab with id ${id}. Call browser_tabs to see the open tabs.`);
    await this.adopt(await this.openTransport(id), true);
  }

  async watchNewTabs(): Promise<() => Promise<TabInfo[]>> {
    await this.connect();
    const opener = this.conn?.targetId;
    const before = new Set((await this.candidateTargets()).map((t) => t.id));
    // A popup opened from an iframe of another process has that frame's target as opener, which is not recognised here: it is not followed.
    return async () => {
      const fresh = (await this.candidateTargets()).filter((t) => !before.has(t.id) && (t.openerId ? t.openerId === opener : !this.strictOpener));
      for (const t of fresh) this.known.add(t.id);
      return fresh.map((t) => ({ id: t.id, url: t.url, title: t.title, active: false }));
    };
  }

  /** Called when `onAttached` threw, after the connection was dropped; subclasses close what they opened. */
  protected async onAttachFailed(_conn: CdpConn): Promise<void> {}

  private onEvent(msg: { method: string; params?: any }) {
    if (msg.params?.frameId !== this.mainFrameId) return;
    if (msg.method === "Page.frameStartedLoading") this.loading = true;
    if (msg.method === "Page.frameStoppedLoading") {
      this.loading = false;
      for (const done of this.loadWaiters.splice(0)) done();
    }
  }

  /** Sends on the current page session without connecting first. */
  protected sendRaw(method: string, params: object = {}): Promise<any> {
    const conn = this.conn;
    if (!conn) return Promise.reject(new Error("Browser connection closed"));
    this.roundTrips++;
    return conn.transport.send(method, params, conn.sessionId);
  }

  private async send(method: string, params: object = {}): Promise<any> {
    await this.connect();
    return this.sendRaw(method, params);
  }

  private waitForLoad(timeoutMs: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.loadWaiters.push(() => (clearTimeout(timer), resolve()));
    });
  }

  async navigate(url: string): Promise<PageState> {
    await this.connect();
    this.loading = true;
    const loaded = this.waitForLoad(15_000);
    const { errorText } = await this.send("Page.navigate", { url });
    this.loadError = errorText || undefined;
    if (errorText) this.loading = false;
    else await loaded;
    return this.state();
  }

  async state(): Promise<PageState> {
    await this.connect();
    try {
      const { url, title } = (await this.evaluate("({ url: location.href, title: document.title })")) as { url: string; title: string };
      return { url, title, loading: this.loading, ...(this.loadError ? { note: `Page failed to load: ${this.loadError}.` } : {}) };
    } catch {
      // The old document is gone mid-navigation.
      return { url: "", title: "", loading: true };
    }
  }

  async back() {
    await this.evaluate("history.back()");
  }

  async reload() {
    const loaded = this.waitForLoad(15_000);
    await this.send("Page.reload");
    await loaded;
  }

  async evaluate(script: string): Promise<unknown> {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", { expression: script, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  /**
   * Looks for password fields in every frame the page session can reach, in an isolated world: it has its own builtins, so
   * code the page planted or patched cannot change the answer. Fails closed: the top frame not answering throws.
   */
  async probe(opts: ProbeOptions = {}): Promise<DocumentProbe> {
    const { frameTree } = await this.send("Page.getFrameTree");
    const frames: { id: string; loaderId: string; url: string; urlFragment?: string }[] = [];
    const collect = (t: { frame: (typeof frames)[number]; childFrames?: any[] }) => (frames.push(t.frame), t.childFrames?.forEach(collect));
    collect(frameTree);
    for (const id of this.guardWorlds.keys()) if (!frames.some((f) => f.id === id)) this.guardWorlds.delete(id);
    let secret = false;
    for (const frame of frames) {
      try {
        if (await this.frameHasPassword(frame, opts)) secret = true;
      } catch (error) {
        if (frame.id === frameTree.frame.id) throw error; // frames in other processes cannot be reached by page script either
      }
    }
    const top = frameTree.frame;
    return { url: top.url + (top.urlFragment ?? ""), documentId: `${top.id}:${top.loaderId}`, secret };
  }

  private async frameHasPassword(frame: { id: string; loaderId: string }, opts: ProbeOptions): Promise<boolean> {
    for (let attempt = 0; ; attempt++) {
      try {
        let world = this.guardWorlds.get(frame.id);
        if (world?.loaderId !== frame.loaderId) {
          const { executionContextId } = await this.send("Page.createIsolatedWorld", { frameId: frame.id, worldName: "pista-guard" });
          this.guardWorlds.set(frame.id, (world = { loaderId: frame.loaderId, contextId: executionContextId }));
        }
        const { result, exceptionDetails } = await this.send("Runtime.evaluate", { expression: scripts.hasPassword(opts.token, opts.clearToken), contextId: world.contextId, returnByValue: true });
        if (exceptionDetails || typeof result?.value !== "boolean") throw new Error("The page could not be checked for password fields.");
        return result.value;
      } catch (error) {
        this.guardWorlds.delete(frame.id); // the world went away with its document: make a new one once
        if (attempt >= 1) throw error;
      }
    }
  }

  async input(event: NativeInput): Promise<boolean> {
    if (event.type === "click") {
      const base = { x: event.x, y: event.y, button: "left", clickCount: 1 };
      await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: event.x, y: event.y });
      await this.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
      await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
      return true;
    }
    if (event.type === "text") {
      await this.send("Input.insertText", { text: event.text });
      return true;
    }
    const parts = event.key.split("+");
    const key = parts.at(-1)!;
    const modifiers = parts.slice(0, -1).reduce((m, name) => m | (MODIFIER_BITS[name.toLowerCase()] ?? 0), 0);
    const [keyCode, code] = KEYS[key] ?? [key.toUpperCase().charCodeAt(0), key.length === 1 ? `Key${key.toUpperCase()}` : key];
    // Printable keys and Enter carry text so they insert characters / submit forms.
    const text = key === "Enter" ? "\r" : key.length === 1 && !(modifiers & 0b0110) ? key : undefined;
    const common = { key: key === "Space" ? " " : key, code, windowsVirtualKeyCode: keyCode, modifiers };
    await this.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", text, ...common });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
    return true;
  }

  async screenshot() {
    const { data } = await this.send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    return { data: data as string, mimeType: "image/jpeg" };
  }

  /** Protocol messages sent so far; the agent loop diffs it per step. The counter is per driver, so deltas mix if one driver serves concurrent calls. */
  stats() {
    return { roundTrips: this.roundTrips };
  }

  close() {
    this.conn?.transport.close();
    this.conn = undefined;
  }
}

/** DOM key names → [windowsVirtualKeyCode, code]. */
const KEYS: Record<string, [number, string]> = {
  Enter: [13, "Enter"],
  Tab: [9, "Tab"],
  Escape: [27, "Escape"],
  Backspace: [8, "Backspace"],
  Delete: [46, "Delete"],
  ArrowLeft: [37, "ArrowLeft"],
  ArrowUp: [38, "ArrowUp"],
  ArrowRight: [39, "ArrowRight"],
  ArrowDown: [40, "ArrowDown"],
  PageUp: [33, "PageUp"],
  PageDown: [34, "PageDown"],
  Home: [36, "Home"],
  End: [35, "End"],
  " ": [32, "Space"],
  Space: [32, "Space"],
};
const MODIFIER_BITS: Record<string, number> = { alt: 1, option: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, command: 4, shift: 8 };
