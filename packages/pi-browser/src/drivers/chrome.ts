import { closeSync, lstatSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { findBrowser, type FoundBrowser } from "../chrome/find.ts";
import { launchBrowser, pistaChromeProfileDir, type LaunchedBrowser } from "../chrome/launch.ts";
import type { CdpEvent } from "../chrome/pipe.ts";
import { checkUrl, type DomainRules } from "../domains.ts";
import type { BrowserDriver } from "../driver.ts";
import { ScreencastFeed, type ScreencastFrame } from "../chrome/screencast.ts";
import { CdpDriver } from "./cdp.ts";

export interface ChromeDriverOptions {
  /** The Pista home; the browser profile lives under it. */
  pistaHome: string;
  /** Enforced on every document request of the page, whatever started it (redirects, links, window.open). */
  domainRules?: DomainRules;
  /** Explicit browser executable (PISTA_BROWSER_PATH). */
  browserPath?: string;
}

export interface ChromeDriverDeps {
  find?: typeof findBrowser;
  launch?: typeof launchBrowser;
}

/** Largest file `download()` keeps; a bigger one is aborted and deleted. */
export const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const MAX_REDIRECTS = 10;
const DOWNLOAD_START_MS = 20_000;
const DOWNLOAD_DONE_MS = 80_000;

/**
 * Drives an external Chrome (or Edge, Brave) started with a dedicated profile over a private pipe: no TCP port is opened.
 * Launches on first use, keeps agent work in one tab, and launches again on the next use when the user closes the browser.
 */
export class ChromeDriver extends CdpDriver implements BrowserDriver {
  private browser: LaunchedBrowser | undefined;
  /** Sessions we intercept: the agent tab and every child target (popups, frames, workers) auto-attached under it. */
  private sessions = new Set<string>();
  private ownTarget: string | undefined;
  private downloadListeners = new Set<(event: CdpEvent) => void>();
  private pageInfo = { url: "", title: "" };
  private casting = false;
  private feed = new ScreencastFeed({
    start: () => void this.startCast(),
    stop: () => void this.stopCast(),
  });

  constructor(
    private options: ChromeDriverOptions,
    private deps: ChromeDriverDeps = {},
  ) {
    super("");
  }

  // One browser and one tab serve every thread, and the rules are the ones of the thread that created the driver (the first); the managed policy is the same for all threads.
  private get rules(): DomainRules | undefined {
    const r = this.options.domainRules;
    return r && (r.allowedDomains || r.deniedDomains?.length) ? r : undefined;
  }

  protected async openTransport() {
    if (!this.browser) {
      const found: FoundBrowser | null = (this.deps.find ?? findBrowser)({ overridePath: this.options.browserPath });
      if (!found) throw new Error("No Chrome, Edge or Brave browser was found. Install Chrome, or set PISTA_BROWSER_PATH to a Chromium-based browser.");
      const browser = await (this.deps.launch ?? launchBrowser)({ browserPath: found.path, profileDir: pistaChromeProfileDir(this.options.pistaHome) });
      this.browser = browser;
      const { transport } = browser;
      transport.onClose(() => {
        if (this.browser === browser) this.browser = undefined;
      });
      transport.onEvent((event) => this.onBrowserEvent(event));
      // Popups and tabs the page opens are separate top-level targets; attach to every new one and hold it until it is guarded.
      if (this.rules) await transport.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    }
    const { transport } = this.browser;
    // A tab of our own: restored tabs from an earlier session may sit on pages the rules deny and are never used.
    const { targetId } = await transport.send("Target.createTarget", { url: "about:blank" });
    this.ownTarget = targetId;
    const { sessionId } = await transport.send("Target.attachToTarget", { targetId, flatten: true });
    this.sessions.add(sessionId);
    return { transport, sessionId };
  }

  /** Intercepts document loads of one session and of every target that attaches under it. */
  private async guardSession(sessionId: string) {
    const transport = this.browser!.transport;
    await transport.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
    await transport.send("Fetch.enable", { patterns: [{ resourceType: "Document" }] }, sessionId);
  }

  private async onChildAttached(sessionId: string, info: { targetId: string; type: string }) {
    const transport = this.browser?.transport;
    if (!transport) return;
    this.sessions.add(sessionId);
    try {
      await this.guardSession(sessionId);
    } catch {
      // A page or frame that cannot be guarded must not run; a worker has no documents to guard.
      if (info.type === "page") await transport.send("Target.closeTarget", { targetId: info.targetId }).catch(() => undefined);
    }
    await transport.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => undefined);
  }

  private onBrowserEvent(event: CdpEvent) {
    const sessionId = this.conn?.sessionId;
    if (event.method === "Target.detachedFromTarget") {
      const gone = event.params?.sessionId;
      this.sessions.delete(gone);
      if (gone === sessionId) this.conn = undefined; // the user closed our tab; the next use opens a new one
    } else if (event.method === "Target.attachedToTarget" && (!event.sessionId || this.sessions.has(event.sessionId)) && this.rules) {
      void this.onChildAttached(event.params.sessionId, event.params.targetInfo);
    } else if (event.method === "Fetch.requestPaused" && event.sessionId && this.sessions.has(event.sessionId)) {
      const { requestId, request } = event.params;
      const reason = this.rules ? checkUrl(request.url, this.rules) : undefined;
      const answer = reason
        ? this.browser!.transport.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, event.sessionId)
        : this.browser!.transport.send("Fetch.continueRequest", { requestId }, event.sessionId);
      answer.catch(() => undefined);
    } else if (event.method === "Page.screencastFrame" && event.sessionId === sessionId) {
      const { data, metadata, sessionId: castId } = event.params;
      // Ack every frame so the browser keeps sending; the feed decides which ones are worth delivering.
      this.sendRaw("Page.screencastFrameAck", { sessionId: castId }).catch(() => undefined);
      this.feed.push({ data, width: metadata?.deviceWidth ?? 0, height: metadata?.deviceHeight ?? 0, ...this.pageInfo });
    } else if (event.method === "Target.targetInfoChanged" && event.params?.targetInfo?.targetId === this.ownTarget) {
      this.pageInfo = { url: event.params.targetInfo.url ?? "", title: event.params.targetInfo.title ?? "" };
    } else if (event.method.startsWith("Browser.download")) {
      for (const listener of this.downloadListeners) listener(event);
    }
  }

  protected async onAttached() {
    // Downloads the agent did not ask for are refused; `download()` allows its own.
    await this.browser!.transport.send("Browser.setDownloadBehavior", { behavior: "deny" });
    // Defence in depth: the guard checks agent-initiated navigations, this checks every document load, redirect and popup.
    if (this.rules) await this.guardSession(this.conn!.sessionId!);
    this.casting = false; // a new tab has no screencast yet
    if (this.feed.count > 0) await this.startCast();
  }

  /** Subscribes to live frames of the agent tab. The screencast runs only while someone listens, and never launches the browser by itself. */
  onFrame(cb: (frame: ScreencastFrame) => void): () => void {
    return this.feed.subscribe(cb);
  }

  // Start and stop run one after the other, so a quick stop can never overtake a start that is still setting up.
  private castChain: Promise<void> = Promise.resolve();
  private startCast() {
    return (this.castChain = this.castChain.then(() => this.doStartCast()));
  }
  private stopCast() {
    return (this.castChain = this.castChain.then(() => this.doStopCast()));
  }

  private async doStartCast() {
    const transport = this.browser?.transport;
    if (!this.conn || !transport || this.casting || this.feed.count === 0) return;
    this.casting = true;
    try {
      await transport.send("Target.setDiscoverTargets", { discover: true });
      if (this.ownTarget) {
        const { targetInfo } = await transport.send("Target.getTargetInfo", { targetId: this.ownTarget });
        this.pageInfo = { url: targetInfo?.url ?? "", title: targetInfo?.title ?? "" };
      }
      await this.sendRaw("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 1280, everyNthFrame: 1 });
    } catch {
      this.casting = false;
    }
  }

  private async doStopCast() {
    if (!this.casting) return;
    this.casting = false;
    await this.sendRaw("Page.stopScreencast").catch(() => undefined);
  }

  /** Brings the browser window to the front (restoring it only if minimized), so the user can take over (sign-in, one-time codes). */
  async bringToFront(): Promise<boolean> {
    if (!this.conn || !this.browser) return false; // not running: never launch a browser just to show it
    await this.sendRaw("Page.bringToFront");
    const transport = this.browser?.transport;
    if (!transport || !this.ownTarget) return true;
    try {
      const { windowId } = await transport.send("Browser.getWindowForTarget", { targetId: this.ownTarget });
      // Only a minimized window is restored; fullscreen and maximized windows stay as the user left them.
      const { bounds } = await transport.send("Browser.getWindowBounds", { windowId });
      if (bounds?.windowState === "minimized") await transport.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    } catch {
      // Windowless or headless browsers have no window to restore.
    }
    return true;
  }

  protected async onAttachFailed() {
    const target = this.ownTarget;
    this.ownTarget = undefined;
    if (target) await this.browser?.transport.send("Target.closeTarget", { targetId: target });
  }

  async download(opts: { path: string; url?: string; trigger?: () => Promise<unknown> }) {
    await this.connect();
    mkdirSync(dirname(opts.path), { recursive: true });
    if (opts.url) return this.fetchTo(opts.url, opts.path);
    return this.captureTo(opts.path, opts.trigger);
  }

  /**
   * Fetches `url` outside the page with the page's cookies and writes it to `path`. Redirects are followed by hand so every hop
   * is checked against the rules before it is requested; the file is streamed, capped, and deleted again on any failure.
   */
  private async fetchTo(url: string, path: string) {
    const userAgent = String(await this.evaluate("navigator.userAgent"));
    const chain: string[] = [];
    let response: Response | undefined;
    for (let hop = url; ; ) {
      const reason = this.rules ? checkUrl(hop, this.rules) : undefined;
      if (reason) throw new Error(`Blocked by your organization's policy: ${reason}.`);
      if (!/^https?:\/\//i.test(hop)) throw new Error("download failed: only http(s) addresses can be downloaded");
      chain.push(hop);
      const { cookies } = await this.sendRaw("Network.getCookies", { urls: [hop] });
      const cookie = (cookies as { name: string; value: string }[]).map((c) => `${c.name}=${c.value}`).join("; ");
      response = await fetch(hop, { redirect: "manual", headers: { "user-agent": userAgent, ...(cookie ? { cookie } : {}) } });
      const next = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
      if (!next) break;
      if (chain.length > MAX_REDIRECTS) throw new Error("download failed: too many redirects");
      hop = new URL(next, hop).href;
    }
    if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length"));
    if (declared > MAX_DOWNLOAD_BYTES) throw new Error("download failed: the file is larger than the download limit");
    const fd = openSync(path, "wx", 0o600); // never follows a link planted at `path`
    let bytes = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        bytes += chunk.length;
        if (bytes > MAX_DOWNLOAD_BYTES) throw new Error("download failed: the file is larger than the download limit");
        writeSync(fd, chunk);
      }
    } catch (error) {
      closeSync(fd);
      rmSync(path, { force: true });
      throw error;
    }
    closeSync(fd);
    const type = response.headers.get("content-type");
    return { bytes, ...(type ? { contentType: type } : {}), urlChain: chain };
  }

  /** Lets the browser save the one download `trigger` causes into the target folder, then moves it to `path`. */
  private async captureTo(path: string, trigger?: () => Promise<unknown>) {
    const transport = this.browser!.transport;
    const dir = dirname(path);
    let listener!: (event: CdpEvent) => void;
    let stopTimer = () => {};
    let seenGuid = "";
    const guidFile = () => (seenGuid ? join(dir, seenGuid) : join(dir, ".none"));
    const done = new Promise<{ guid: string; url: string }>((resolve, reject) => {
      let guid = "";
      let url = "";
      let timer = setTimeout(() => reject(new Error("download failed: no download started")), DOWNLOAD_START_MS);
      listener = (event) => {
        const p = event.params;
        if (event.method === "Browser.downloadWillBegin" && !guid) {
          guid = seenGuid = p.guid;
          url = p.url;
          clearTimeout(timer);
          timer = setTimeout(() => reject(new Error("download failed: timed out")), DOWNLOAD_DONE_MS);
        } else if (event.method === "Browser.downloadProgress" && p.guid === guid) {
          if (p.receivedBytes > MAX_DOWNLOAD_BYTES) {
            transport.send("Browser.cancelDownload", { guid }).catch(() => undefined);
            (clearTimeout(timer), reject(new Error("download failed: the file is larger than the download limit")));
          }
          if (p.state === "completed") (clearTimeout(timer), resolve({ guid, url }));
          if (p.state === "canceled") (clearTimeout(timer), reject(new Error("download failed: the browser cancelled it")));
        }
      };
      this.downloadListeners.add(listener);
      stopTimer = () => clearTimeout(timer);
    });
    done.catch(() => undefined);
    try {
      await transport.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: dir, eventsEnabled: true });
      await trigger?.();
      const { guid, url } = await done;
      try {
        lstatSync(path);
        throw new Error("download failed: a file already exists at that path");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      renameSync(join(dir, guid), path);
      return { bytes: statSync(path).size, urlChain: [url] };
    } catch (error) {
      for (const f of [guidFile()]) rmSync(f, { force: true });
      throw error;
    } finally {
      stopTimer();
      this.downloadListeners.delete(listener);
      await transport.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => undefined);
    }
  }

  close() {
    super.close();
    const browser = this.browser;
    this.browser = undefined;
    void browser?.close();
  }
}
