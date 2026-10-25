import type { BrowserDriver, NativeInput, PageState } from "../driver.ts";

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };

/**
 * Drives one page of a Chromium-based browser over the DevTools Protocol, e.g. Chrome started
 * with `--remote-debugging-port=9222`. Attaches to the first open page (or opens one) and
 * injects trusted input through `Input.*`, so it behaves like the desktop app's pane.
 */
export class CdpDriver implements BrowserDriver {
  private ws: WebSocket | undefined;
  private connecting: Promise<void> | undefined;
  private seq = 0;
  private roundTrips = 0;
  private pending = new Map<number, Pending>();
  private mainFrameId = "";
  private loading = false;
  private loadError: string | undefined;
  private loadWaiters: (() => void)[] = [];

  constructor(private endpoint = "http://127.0.0.1:9222") {}

  private connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    this.connecting ??= this.open().finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  private async open() {
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
    ws.onmessage = (message) => this.onMessage(JSON.parse(String(message.data)));
    ws.onclose = () => {
      for (const p of this.pending.values()) p.reject(new Error("Browser connection closed"));
      this.pending.clear();
      this.ws = undefined;
    };
    this.ws = ws;
    await this.send("Page.enable");
    const { frameTree } = await this.send("Page.getFrameTree");
    this.mainFrameId = frameTree.frame.id;
  }

  private onMessage(msg: { id?: number; result?: any; error?: { message: string }; method?: string; params?: any }) {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p?.reject(new Error(msg.error.message));
      else p?.resolve(msg.result);
      return;
    }
    if (msg.params?.frameId !== this.mainFrameId) return;
    if (msg.method === "Page.frameStartedLoading") this.loading = true;
    if (msg.method === "Page.frameStoppedLoading") {
      this.loading = false;
      for (const done of this.loadWaiters.splice(0)) done();
    }
  }

  private async send(method: string, params: object = {}): Promise<any> {
    if (method !== "Page.enable" && method !== "Page.getFrameTree") await this.connect();
    const id = ++this.seq;
    this.roundTrips++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
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
    this.ws?.close();
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
