import { closeSync, lstatSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { findBrowser, type FoundBrowser } from "../chrome/find.ts";
import { launchBrowser, pistaChromeProfileDir, type LaunchedBrowser } from "../chrome/launch.ts";
import type { CdpEvent } from "../chrome/pipe.ts";
import { checkUrl, type DomainRules } from "../domains.ts";
import { internalPageReason } from "../eval-gate.ts";
import { readLoginOrigins } from "../chrome/login-origins.ts";
import type { BrowserDriver } from "../driver.ts";
import { ScreencastFeed, type ScreencastFrame } from "../chrome/screencast.ts";
import { CdpDriver, type CdpConn, type PageTarget } from "./cdp.ts";

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
  /** The session we hold for each page target (the agent tab and the popups auto-attached under it), so switching back reuses it. */
  private sessionOf = new Map<string, string>();
  /** Page targets that are ours: the agent tab and every tab opened from one of ours. Restored tabs of an earlier session never are. */
  private ours = new Set<string>();
  /** Who opened each of our tabs, as last seen, for going back when a tab closes. */
  private openers = new Map<string, string>();
  /** Where to go when the active tab closed: its opener, if that is still open. */
  private returnTo: string | undefined;
  private downloadListeners = new Set<(event: CdpEvent) => void>();
  private pageInfo = { url: "", title: "" };
  private casting = false;
  private closedListeners = new Set<() => void>();
  private feed = new ScreencastFeed({
    start: () => void this.startCast(),
    stop: () => void this.stopCast(),
  });

  constructor(
    private options: ChromeDriverOptions,
    private deps: ChromeDriverDeps = {},
  ) {
    super("");
    this.strictOpener = true;
  }

  // One browser and one tab serve every thread, and the rules are the ones of the thread that created the driver (the first); the managed policy is the same for all threads.
  private get rules(): DomainRules | undefined {
    const r = this.options.domainRules;
    return r && (r.allowedDomains || r.deniedDomains?.length) ? r : undefined;
  }

  async navigate(url: string) {
    const reason = internalPageReason(url);
    if (reason) throw new Error(`Not opened: ${reason}`);
    return super.navigate(url);
  }

  /** Origins with a saved login in the dedicated profile's password manager (addresses only). */
  savedLoginOrigins() {
    return readLoginOrigins(pistaChromeProfileDir(this.options.pistaHome));
  }

  /** Our tabs only: the browser may hold restored tabs or the user's own, which the agent never sees. */
  protected async candidateTargets(): Promise<PageTarget[]> {
    const transport = this.browser?.transport;
    if (!transport) return [];
    const { targetInfos } = await transport.send("Target.getTargets");
    const pages = ((targetInfos ?? []) as { targetId: string; type: string; url: string; title: string; openerId?: string }[]).filter((t) => t.type === "page");
    for (let grew = true; grew; ) {
      grew = false;
      for (const t of pages) if (!this.ours.has(t.targetId) && t.openerId && this.ours.has(t.openerId)) (this.ours.add(t.targetId), (grew = true));
    }
    for (const t of pages) if (t.openerId) this.openers.set(t.targetId, t.openerId);
    // Oldest first: the browser's own order changes with focus.
    const order = [...this.ours];
    return pages.filter((t) => this.ours.has(t.targetId)).sort((a, b) => order.indexOf(a.targetId) - order.indexOf(b.targetId)).map((t) => ({ id: t.targetId, url: t.url, title: t.title, ...(t.openerId ? { openerId: t.openerId } : {}) }));
  }

  /** The tab to go back to after the active one closed: its opener, else our first tab, whichever is still open. */
  private async tabToReturnTo(transport: CdpConn["transport"]): Promise<string | undefined> {
    const wanted = [this.returnTo, this.ownTarget];
    this.returnTo = undefined;
    const { targetInfos } = await transport.send("Target.getTargets");
    const open = new Set(((targetInfos ?? []) as { targetId: string }[]).map((t) => t.targetId));
    return wanted.find((id): id is string => Boolean(id) && open.has(id!));
  }

  protected async openTransport(targetId?: string): Promise<CdpConn> {
    if (!this.browser) {
      const found: FoundBrowser | null = (this.deps.find ?? findBrowser)({ overridePath: this.options.browserPath });
      if (!found) throw new Error("No Chrome, Edge or Brave browser was found. Install Chrome, or set PISTA_BROWSER_PATH to a Chromium-based browser.");
      const browser = await (this.deps.launch ?? launchBrowser)({ browserPath: found.path, profileDir: pistaChromeProfileDir(this.options.pistaHome) });
      this.browser = browser;
      this.ownTarget = this.returnTo = undefined;
      for (const m of [this.sessionOf, this.openers, this.ours]) m.clear();
      const { transport } = browser;
      transport.onClose(() => {
        if (this.browser !== browser) return;
        this.browser = undefined;
        for (const cb of [...this.closedListeners]) cb();
      });
      transport.onEvent((event) => this.onBrowserEvent(event));
      // Popups and tabs the page opens are separate top-level targets; attach to every new one and hold it until it is set up (and guarded, when there are rules).
      await transport.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
      await transport.send("Target.setDiscoverTargets", { discover: true }); // targetDestroyed events prune our tab bookkeeping
    }
    const { transport } = this.browser;
    // Our own tab again, or the one that opened the tab that closed, when it is still there.
    targetId ??= await this.tabToReturnTo(transport);
    if (!targetId) {
      // A tab of our own: restored tabs from an earlier session may sit on pages the rules deny and are never used.
      ({ targetId } = await transport.send("Target.createTarget", { url: "about:blank" }));
      this.ownTarget = targetId;
      this.ours.add(targetId!);
    }
    let sessionId = this.sessionOf.get(targetId!);
    if (!sessionId) {
      ({ sessionId } = await transport.send("Target.attachToTarget", { targetId, flatten: true }));
      this.sessionOf.set(targetId!, sessionId!);
    }
    this.sessions.add(sessionId!);
    return { transport, sessionId, targetId };
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
    // A tab we switch to while this runs may get a second session of its own: benign, but switching prefers the one known here.
    if (info.type === "page" && !this.sessionOf.has(info.targetId)) this.sessionOf.set(info.targetId, sessionId);
    try {
      if (this.rules) await this.guardSession(sessionId);
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
      for (const [target, session] of this.sessionOf) if (session === gone) this.sessionOf.delete(target);
      if (gone === sessionId) {
        // The tab closed: the next use goes back to the tab that opened it, or opens a new one.
        this.returnTo = (this.conn?.targetId ? this.openers.get(this.conn.targetId) : undefined) ?? this.returnTo;
        this.conn = undefined;
      }
    } else if (event.method === "Target.targetDestroyed") {
      const id = event.params?.targetId as string;
      if (id && id === this.conn?.targetId) this.returnTo ??= this.openers.get(id);
      this.ours.delete(id);
      this.openers.delete(id);
    } else if (event.method === "Target.attachedToTarget" && (!event.sessionId || this.sessions.has(event.sessionId))) {
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
    } else if (event.method === "Target.targetInfoChanged" && event.params?.targetInfo?.targetId === (this.conn?.targetId ?? this.ownTarget)) {
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

  /** Calls `cb` when the running browser goes away (the user quit it, or it crashed); the next browser step launches a new one. */
  onClosed(cb: () => void): () => void {
    this.closedListeners.add(cb);
    return () => void this.closedListeners.delete(cb);
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
      const active = this.conn.targetId ?? this.ownTarget;
      if (active) {
        const { targetInfo } = await transport.send("Target.getTargetInfo", { targetId: active });
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
    const active = this.conn.targetId ?? this.ownTarget;
    if (!transport || !active) return true;
    try {
      const { windowId } = await transport.send("Browser.getWindowForTarget", { targetId: active });
      // Only a minimized window is restored; fullscreen and maximized windows stay as the user left them.
      const { bounds } = await transport.send("Browser.getWindowBounds", { windowId });
      if (bounds?.windowState === "minimized") await transport.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    } catch {
      // Windowless or headless browsers have no window to restore.
    }
    return true;
  }

  protected async onAttachFailed(conn: CdpConn) {
    const target = conn.targetId ?? this.ownTarget;
    if (target === this.ownTarget) this.ownTarget = undefined;
    if (target) await this.browser?.transport.send("Target.closeTarget", { targetId: target });
  }

  async switchTab(id: string) {
    if (this.conn?.targetId === id) return;
    // The tab we leave stops casting; the one we enter starts in onAttached.
    await this.stopCast();
    try {
      await super.switchTab(id);
      // Show it as the browser's current tab: a background tab loads and paints slowly.
      await this.browser?.transport.send("Target.activateTarget", { targetId: id }).catch(() => undefined);
    } catch (error) {
      if (this.feed.count > 0) await this.startCast();
      throw error;
    }
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
    void this.closeGracefully().catch(() => {});
  }

  /**
   * Closes the browser the way a user would (Browser.close, then SIGTERM, then SIGKILL), so it flushes cookies and
   * marks the profile as cleanly exited. The pipe must stay open until then, so the connection is not closed first.
   */
  async closeGracefully(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    this.conn = undefined;
    await browser?.close();
  }
}
