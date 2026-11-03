import type { CdpEvent, CdpTransport } from "../chrome/pipe.ts";
import type { BrowserDriver, DocumentProbe, NativeInput, PageState, ProbeOptions } from "../driver.ts";
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

/**
 * Drives one page of a Chromium-based browser over the DevTools Protocol, e.g. Chrome started
 * with `--remote-debugging-port=9222`. Attaches to the first open page (or opens one) and
 * injects trusted input through `Input.*`, so it behaves like the desktop app's pane.
 * The protocol logic runs on any `CdpTransport`: subclasses override `openTransport`.
 */
export class CdpDriver implements BrowserDriver {
  protected conn: { transport: CdpTransport; sessionId?: string } | undefined;
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

  /** Connects to the browser and returns the transport plus the session of the page to drive (none for a per-page WebSocket). */
  protected async openTransport(): Promise<{ transport: CdpTransport; sessionId?: string }> {
    type Target = { type: string; url: string; webSocketDebuggerUrl: string };
    let targets: Target[];
    try {
      targets = (await (await fetch(`${this.endpoint}/json/list`)).json()) as Target[];
    } catch {
      throw new Error(
        `No browser is listening for DevTools connections at ${this.endpoint}. Start Chrome or Chromium with --remote-debugging-port=9222 (and a separate --user-data-dir), or set PI_BROWSER_CDP_URL.`,
      );
    }
    let target = targets.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
    target ??= (await (await fetch(`${this.endpoint}/json/new?about:blank`, { method: "PUT" })).json()) as Target;
    const ws = new WebSocket(target!.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`Could not connect to ${target!.webSocketDebuggerUrl}`));
    });
    return { transport: new WebSocketTransport(ws) };
  }

  /** Runs after the page is enabled and its frame is known; subclasses add their per-page setup here. */
  protected async onAttached(): Promise<void> {}

  private async open() {
    const { transport, sessionId } = await this.openTransport();
    const conn = { transport, sessionId };
    transport.onClose(() => {
      if (this.conn === conn) this.conn = undefined;
    });
    transport.onEvent((event) => {
      if (event.sessionId === sessionId) this.onEvent(event);
    });
    this.conn = conn;
    this.guardWorlds.clear();
    await this.sendRaw("Page.enable");
    const { frameTree } = await this.sendRaw("Page.getFrameTree");
    this.mainFrameId = frameTree.frame.id;
    try {
      await this.onAttached();
    } catch (error) {
      // Fail closed: a page whose setup failed is never used; the next call retries from scratch.
      this.conn = undefined;
      await this.onAttachFailed(conn).catch(() => undefined);
      throw error;
    }
  }

  /** Called when `onAttached` threw, after the connection was dropped; subclasses close what they opened. */
  protected async onAttachFailed(_conn: { transport: CdpTransport; sessionId?: string }): Promise<void> {}

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
