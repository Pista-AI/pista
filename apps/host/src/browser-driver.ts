import { CdpDriver, type BrowserDriver, type PageState } from "@pista/pi-browser";
import type { BrowserAction, BrowserInput, BrowserResult } from "@pista/protocol";
import type { Hub } from "./hub.ts";

/** Mutable binding so a driver created before the session knows which thread it serves. */
export interface ThreadRef {
  threadId: string;
}

/**
 * Which browser the `browser_*` tools drive. `pane` is the UI's browser pane (native view in the
 * desktop shell, iframe fallback on the web); `cdp` is a Chromium reached over the DevTools Protocol.
 */
export type BrowserDriverConfig = { kind: "pane" } | { kind: "cdp"; url: string };

/** Reads PISTA_BROWSER_DRIVER (default `pane`) and PI_BROWSER_CDP_URL. Throws a startup-grade error on bad input. */
export function resolveBrowserDriverConfig(env: Record<string, string | undefined> = process.env): BrowserDriverConfig {
  const kind = env.PISTA_BROWSER_DRIVER?.trim() || "pane";
  if (kind === "pane") return { kind };
  if (kind === "cdp") {
    const url = env.PI_BROWSER_CDP_URL?.trim();
    if (!url) {
      throw new Error("PISTA_BROWSER_DRIVER=cdp needs PI_BROWSER_CDP_URL (e.g. http://127.0.0.1:9222) pointing at a Chromium started with --remote-debugging-port.");
    }
    return { kind, url };
  }
  throw new Error(`Unknown PISTA_BROWSER_DRIVER "${kind}". Use "pane" (default) or "cdp".`);
}

let active: BrowserDriverConfig | undefined;

/** The configuration for this process, resolved once from the environment. */
export function activeBrowserDriverConfig(): BrowserDriverConfig {
  return (active ??= resolveBrowserDriverConfig());
}

/** One log line naming the active driver, for startup. */
export function describeBrowserDriver(config: BrowserDriverConfig): string {
  return config.kind === "cdp" ? `browser driver: cdp (${config.url})` : "browser driver: pane";
}

// CdpDriver attaches to one page (see packages/pi-browser/src/drivers/cdp.ts), so every thread shares one
// connection and one tab. The cdp driver is a seam for single-thread use until per-thread targets exist.
const cdpDrivers = new Map<string, CdpDriver>();

/** The single selection point: builds the driver for a thread according to the configuration. */
export function createBrowserDriver(config: BrowserDriverConfig, deps: { hub: Hub; ref: ThreadRef }): BrowserDriver {
  if (config.kind === "cdp") {
    let driver = cdpDrivers.get(config.url);
    if (!driver) cdpDrivers.set(config.url, (driver = new CdpDriver(config.url)));
    return driver;
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

  private async ask(request: BrowserAction): Promise<BrowserResult> {
    // The label rides along with the first request of each action, for the badge over the page.
    const activity = this.activity;
    this.activity = undefined;
    return this.hub.ask<BrowserResult>(
      (requestId) => ({ type: "browser.request", requestId, threadId: this.ref.threadId, request: { ...request, activity } }),
      45_000,
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
  async screenshot() {
    const r = await this.ask({ action: "screenshot" });
    if (!r.image) throw new Error(r.note ?? "Screenshot unavailable.");
    return r.image;
  }
}
