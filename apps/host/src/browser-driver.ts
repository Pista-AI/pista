import { CdpDriver, ChromeDriver, findBrowser, type BrowserDriver, type DomainRules, type FoundBrowser, type PageState } from "@pista/pi-browser";
import type { BrowserAction, BrowserEngineSetting, BrowserInput, BrowserResult } from "@pista/protocol";
import type { Hub } from "./hub.ts";
import { CLIENT_DIR } from "./pi-env.ts";

/** Mutable binding so a driver created before the session knows which thread it serves. */
export interface ThreadRef {
  threadId: string;
  /** The thread's working folder, once known; `browser_download` saves under it. */
  cwd?: string;
}

/**
 * Which browser the `browser_*` tools drive. `pane` is the UI's browser pane (native view in the
 * desktop shell, iframe fallback on the web); `cdp` is a Chromium reached over the DevTools Protocol;
 * `chrome` is an external Chrome/Edge/Brave started with a dedicated profile over a private pipe (no TCP port).
 */
export type BrowserDriverConfig = { kind: "pane" } | { kind: "cdp"; url: string } | { kind: "chrome"; browserPath?: string };

const BROWSER_NAMES = { chrome: "Google Chrome", edge: "Microsoft Edge", brave: "Brave" } as const;

export interface BrowserEngineResolution {
  config: BrowserDriverConfig;
  /** Why this engine, for the UI (for example `auto: no Chrome found`). */
  reason: string;
  /** Display name of the external browser when the engine is `chrome`. */
  browserName?: string;
  /** True when Chrome was wanted (auto or the setting) but none was found, so the built-in browser is used. */
  fallback?: boolean;
}

/**
 * Picks the engine. Order: PISTA_BROWSER_DRIVER (dev and evals), then the `browser.engine` setting, then `auto`
 * (`chrome` when a Chrome-family browser is found, else `pane`). Also reads PISTA_BROWSER_PATH and PI_BROWSER_CDP_URL.
 * Throws a startup-grade error on bad env input.
 */
export function resolveBrowserEngine(
  env: Record<string, string | undefined> = process.env,
  setting: BrowserEngineSetting = "auto",
  find: (overridePath?: string) => FoundBrowser | null = (overridePath) => findBrowser({ overridePath }),
  /** A managed policy pins the setting: PISTA_BROWSER_DRIVER is then ignored. */
  pinned = false,
): BrowserEngineResolution {
  const override = env.PISTA_BROWSER_PATH?.trim() || undefined;
  const chrome = (reason: string, found: FoundBrowser | null): BrowserEngineResolution => ({
    config: { kind: "chrome", ...(override ? { browserPath: override } : {}) },
    reason,
    ...(found ? { browserName: BROWSER_NAMES[found.kind] } : {}),
  });
  const envKind = pinned ? undefined : env.PISTA_BROWSER_DRIVER?.trim();
  if (envKind === "pane") return { config: { kind: "pane" }, reason: "PISTA_BROWSER_DRIVER=pane" };
  if (envKind === "cdp") {
    const url = env.PI_BROWSER_CDP_URL?.trim();
    if (!url) {
      throw new Error("PISTA_BROWSER_DRIVER=cdp needs PI_BROWSER_CDP_URL (e.g. http://127.0.0.1:9222) pointing at a Chromium started with --remote-debugging-port.");
    }
    return { config: { kind: "cdp", url }, reason: "PISTA_BROWSER_DRIVER=cdp" };
  }
  if (envKind === "chrome") return chrome("PISTA_BROWSER_DRIVER=chrome", find(override));
  if (envKind) throw new Error(`Unknown PISTA_BROWSER_DRIVER "${envKind}". Use "pane", "cdp" or "chrome".`);
  if (setting === "embedded") return { config: { kind: "pane" }, reason: "setting: built-in browser" };
  const found = find(override);
  if (found) return chrome(setting === "chrome" ? "setting: Chrome" : "auto: found a Chrome-family browser", found);
  return { config: { kind: "pane" }, reason: setting === "chrome" ? "setting: Chrome, but no Chrome found" : "auto: no Chrome found", fallback: true };
}

/** Like `resolveBrowserEngine`, without the explanation. */
export function resolveBrowserDriverConfig(...args: Parameters<typeof resolveBrowserEngine>): BrowserDriverConfig {
  return resolveBrowserEngine(...args).config;
}

let engineSetting: BrowserEngineSetting = "auto";
let enginePinned = false;
let warnedPinned = false;

/** Sets the persisted `browser.engine` value. A thread picks the engine when its session is built, so a change reaches new threads and idle ones the host reloads. */
export function setBrowserEngineSetting(value: BrowserEngineSetting | undefined, pinned = false): void {
  engineSetting = value ?? "auto";
  enginePinned = pinned;
}

/** The resolution for this process right now (environment, then setting, then auto). */
export function activeBrowserEngine(): BrowserEngineResolution {
  if (enginePinned && process.env.PISTA_BROWSER_DRIVER?.trim() && !warnedPinned) {
    warnedPinned = true;
    console.log("[pista-host] browser engine is pinned by policy; PISTA_BROWSER_DRIVER is ignored");
  }
  return resolveBrowserEngine(process.env, engineSetting, undefined, enginePinned);
}

export function activeBrowserDriverConfig(): BrowserDriverConfig {
  return activeBrowserEngine().config;
}

/** One log line naming the active driver, for startup. */
export function describeBrowserDriver(config: BrowserDriverConfig): string {
  return config.kind === "cdp" ? `browser driver: cdp (${config.url})` : `browser driver: ${config.kind}`;
}

// CdpDriver attaches to one page (see packages/pi-browser/src/drivers/cdp.ts), so every thread shares one
// connection and one tab. The cdp driver is a seam for single-thread use until per-thread targets exist.
const cdpDrivers = new Map<string, CdpDriver>();
// One external browser per host, so the chrome driver is shared the same way.
let chromeDriver: ChromeDriver | undefined;

/** Closes the agent's Chrome gracefully (flushing its cookies) at host shutdown; bounded so a stuck browser cannot hold the host. */
export async function closeChromeDriver(timeoutMs = 9000): Promise<void> {
  const driver = chromeDriver;
  chromeDriver = undefined;
  if (!driver) return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([driver.closeGracefully().catch(() => undefined), new Promise<void>((r) => (timer = setTimeout(r, timeoutMs)))]);
  clearTimeout(timer);
}

/** Brings the agent's Chrome to the front; false when there is no running Chrome to show (or another driver is active). */
export async function bringChromeToFront(): Promise<boolean> {
  return (await chromeDriver?.bringToFront()) ?? false; // never launches Chrome: a browser that is not running has nothing to show
}

/** The single selection point: builds the driver for a thread according to the configuration. */
export function createBrowserDriver(config: BrowserDriverConfig, deps: { hub: Hub; ref: ThreadRef; domainRules?: DomainRules; pistaHome?: string }): BrowserDriver {
  if (config.kind === "cdp") {
    let driver = cdpDrivers.get(config.url);
    if (!driver) cdpDrivers.set(config.url, (driver = new CdpDriver(config.url)));
    return driver;
  }
  if (config.kind === "chrome") {
    if (!chromeDriver) {
      const created = (chromeDriver = new ChromeDriver({ pistaHome: deps.pistaHome ?? CLIENT_DIR, domainRules: deps.domainRules, browserPath: config.browserPath }));
      // The screencast runs only while at least one window shows the live view.
      let stop: (() => void) | undefined;
      const apply = (count: number) => {
        if (count > 0 && !stop) stop = created.onFrame((frame) => deps.hub.emitFrame(frame));
        else if (count === 0) (stop?.(), (stop = undefined));
      };
      created.onClosed(() => deps.hub.emitClosed());
      deps.hub.onViewersChanged(apply);
      apply(deps.hub.viewerCount); // a window may have subscribed before this driver existed
    }
    return chromeDriver;
  }
  return new PaneBrowserDriver(deps.hub, deps.ref);
}

/** Drives the UI's browser pane (native view in the desktop shell, iframe on the web) through the hub. */
export class PaneBrowserDriver implements BrowserDriver {
  private activity: string | undefined;

  constructor(
    private hub: Hub,
    private ref: ThreadRef,
  ) {}

  private async ask(request: BrowserAction, timeoutMs = 45_000): Promise<BrowserResult> {
    // The label rides along with the first request of each action, for the badge over the page.
    const activity = this.activity;
    this.activity = undefined;
    return this.hub.ask<BrowserResult>(
      (requestId) => ({ type: "browser.request", requestId, threadId: this.ref.threadId, request: { ...request, activity } }),
      timeoutMs,
      undefined,
      "browser",
    );
  }

  private toState(r: BrowserResult): PageState {
    return { url: r.url ?? "", title: r.title ?? "", loading: Boolean(r.loading), ...(r.note ? { note: r.note } : {}) };
  }

  setActivity(label: string) {
    this.activity = label;
  }
  async navigate(url: string) {
    return this.toState(await this.ask({ action: "navigate", url }));
  }
  async state() {
    return this.toState(await this.ask({ action: "state" }));
  }
  async tabs() {
    const page = await this.state();
    return [{ id: "1", url: page.url, title: page.title, active: true }];
  }
  async switchTab(_id: string): Promise<void> {
    throw new Error("The built-in browser has one tab, so there is nothing to switch to.");
  }
  async back() {
    await this.ask({ action: "back" });
  }
  async reload() {
    await this.ask({ action: "reload" });
  }
  async evaluate(script: string) {
    return (await this.ask({ action: "eval", script })).value;
  }
  async input(event: BrowserInput) {
    return Boolean((await this.ask({ action: "input", event })).value);
  }
  async download(opts: { path: string; url?: string; trigger?: () => Promise<unknown> }) {
    await this.ask({ action: "download.arm", path: opts.path, ...(this.ref.cwd ? { root: this.ref.cwd } : {}), ...(opts.url ? { url: opts.url } : {}) });
    try {
      await opts.trigger?.();
    } catch (error) {
      // Disarm by waiting it out is wasteful; a failed trigger means nothing can start, so report it as is.
      this.ask({ action: "download.wait" }, 20_000).catch(() => undefined);
      throw error;
    }
    const r = await this.ask({ action: "download.wait" }, 80_000);
    if (!r.download) throw new Error(r.note ?? "download failed");
    return r.download;
  }
  async loginList() {
    return (await this.ask({ action: "login.list" })).logins ?? [];
  }
  async loginFill(site: string) {
    const r = await this.ask({ action: "login.fill", site }, 60_000);
    if (!r.login) throw new Error(r.note ?? "sign-in failed");
    return r.login;
  }
  async screenshot() {
    const r = await this.ask({ action: "screenshot" });
    if (!r.image) throw new Error(r.note ?? "Screenshot unavailable.");
    return r.image;
  }
}
