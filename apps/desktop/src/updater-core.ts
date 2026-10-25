/**
 * Auto-update decisions and control flow, free of `electron` so it can be unit tested.
 * main.ts supplies the real electron-updater instance and native dialogs.
 *
 * Security: the update signature is enforced by Squirrel.Mac (macOS, Developer ID signed app).
 * Never replace `verifyUpdateCodeSignature`, never set `forceDevUpdateConfig`.
 */

export interface UpdatesSummaryLike {
  enabled: boolean;
  channel: "stable" | "beta";
  feedUrl?: string;
  enforcementHours?: number;
}
export type VersionGateLike = { status: "ok" } | { status: "below" | "above"; current: string };

export interface UpdaterConfigInput {
  isPackaged: boolean;
  platform: string;
  hasAppUpdateYml: boolean;
  summary?: UpdatesSummaryLike;
  gate?: VersionGateLike;
}

export type UpdaterConfig =
  | { enabled: false; reason: string }
  | { enabled: true; feedUrl?: string; channel: "latest" | "beta"; enforcementHours?: number; checkNow: boolean };

/** Runtime validation of the `/health` JSON; wrong types give no summary, which resolves to disabled. */
export function parseHealth(json: unknown): { summary?: UpdatesSummaryLike; gate?: VersionGateLike } {
  const obj = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const u = obj.updates as Record<string, unknown> | null | undefined;
  let summary: UpdatesSummaryLike | undefined;
  if (u && typeof u === "object" && typeof u.enabled === "boolean" && (u.channel === "stable" || u.channel === "beta") && (u.feedUrl === undefined || typeof u.feedUrl === "string")) {
    const hours = u.enforcementHours;
    summary = {
      enabled: u.enabled,
      channel: u.channel,
      ...(u.feedUrl ? { feedUrl: u.feedUrl as string } : {}),
      ...(typeof hours === "number" && Number.isInteger(hours) && hours > 0 ? { enforcementHours: hours } : {}),
    };
  }
  const g = obj.versionGate as Record<string, unknown> | null | undefined;
  const gate: VersionGateLike | undefined =
    g && g.status === "ok" ? { status: "ok" } : g && (g.status === "below" || g.status === "above") && typeof g.current === "string" ? { status: g.status, current: g.current } : undefined;
  return { ...(summary ? { summary } : {}), ...(gate ? { gate } : {}) };
}

export function resolveUpdaterConfig(input: UpdaterConfigInput): UpdaterConfig {
  const off = (reason: string): UpdaterConfig => ({ enabled: false, reason });
  if (!input.isPackaged) return off("not a packaged build");
  if (input.platform !== "darwin") return off("auto-update is macOS only for now");
  if (!input.summary) return off("host policy unavailable");
  if (!input.summary.enabled) return off("disabled by policy or PISTA_DISABLE_AUTOUPDATER");
  const feedUrl = input.summary.feedUrl;
  // Unsigned builds ship no app-update.yml; Squirrel.Mac refuses unsigned updates even with a feedUrl.
  if (!input.hasAppUpdateYml && !feedUrl) return off("no update feed configured");
  return {
    enabled: true,
    ...(feedUrl ? { feedUrl } : {}),
    channel: input.summary.channel === "beta" ? "beta" : "latest",
    ...(input.summary.enforcementHours ? { enforcementHours: input.summary.enforcementHours } : {}),
    checkNow: input.gate?.status === "below",
  };
}

/** The subset of electron-updater's AppUpdater that the controller uses. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  disableWebInstaller: boolean;
  channel: string | null;
  setFeedURL(options: { provider: "generic"; url: string }): void;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

export interface UpdatePrompt {
  askRestart(info: { version?: string }): Promise<"now" | "later">;
  forceRestart(info: { version?: string }, seconds: number): Promise<void>;
}

export interface UpdateTimers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  setInterval(fn: () => void, ms: number): unknown;
  unref(handle: unknown): void;
}

export const FORCE_COUNTDOWN_SECONDS = 60;
export const CHECK_INTERVAL_MS = 4 * 3600_000;
export const FIRST_CHECK_DELAY_MS = 30_000;
/** Node timers overflow past 2^31-1 ms (about 596 h) and fire at once, so long waits are re-armed in chunks. */
export const MAX_TIMER_MS = 24 * 3600_000;

type Info = { version?: string };

export class UpdateController {
  private deps: { updater: UpdaterLike; prompt: UpdatePrompt; timers: UpdateTimers; log: (msg: string) => void };
  private seenVersion: string | undefined; // "" stands for an unknown version
  private pending: Info | undefined;
  private firstDownloadedAt: number | undefined;
  private prompting = false;
  private forcing = false;
  private installing = false;
  private enforcementArmed = false;

  constructor(deps: { updater: UpdaterLike; prompt: UpdatePrompt; timers: UpdateTimers; log: (msg: string) => void }) {
    this.deps = deps;
  }

  start(config: UpdaterConfig): void {
    if (!config.enabled) return;
    const { updater, timers, log } = this.deps;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.disableWebInstaller = true;
    updater.allowDowngrade = false;
    if (config.feedUrl) updater.setFeedURL({ provider: "generic", url: config.feedUrl });
    if (config.channel !== "latest") {
      updater.channel = config.channel;
      updater.allowDowngrade = false; // setting a channel flips allowDowngrade on
    }
    updater.on("error", (error: unknown) => log(`error: ${error instanceof Error ? error.message : String(error)}`));
    updater.on("update-downloaded", (info: Info) => {
      this.onDownloaded(info, config.enforcementHours, config.checkNow).catch((e) => log(`update handling failed: ${String(e)}`));
    });
    const check = () => {
      updater.checkForUpdates().catch((e: unknown) => log(`check failed: ${e instanceof Error ? e.message : String(e)}`));
    };
    if (config.checkNow) check();
    else timers.unref(timers.setTimeout(check, FIRST_CHECK_DELAY_MS));
    timers.unref(timers.setInterval(check, CHECK_INTERVAL_MS));
  }

  /** Once-only: electron-updater re-reports the cached download on every check. */
  private install(): void {
    if (this.installing) return;
    this.installing = true;
    this.deps.updater.quitAndInstall();
  }

  private async force(info: Info): Promise<void> {
    if (this.installing || this.forcing) return;
    this.forcing = true;
    await this.deps.prompt.forceRestart(info, FORCE_COUNTDOWN_SECONDS);
    this.install();
  }

  private armEnforcement(deadline: number): void {
    const { timers, log } = this.deps;
    const remaining = deadline - timers.now();
    if (remaining <= 0) {
      this.force(this.pending ?? {}).catch((e) => log(`forced restart failed: ${String(e)}`));
      return;
    }
    timers.unref(timers.setTimeout(() => this.armEnforcement(deadline), Math.min(remaining, MAX_TIMER_MS)));
  }

  private async onDownloaded(info: Info, enforcementHours: number | undefined, gateBelow: boolean): Promise<void> {
    const version = info.version ?? "";
    if (this.installing || version === this.seenVersion) return;
    this.seenVersion = version;
    this.pending = info;
    this.firstDownloadedAt ??= this.deps.timers.now();
    if (gateBelow) return this.force(info);
    if (this.prompting || this.enforcementArmed) return; // a newer build replaces `pending` only
    this.prompting = true;
    let answer: "now" | "later";
    try {
      answer = await this.deps.prompt.askRestart(info);
    } finally {
      this.prompting = false;
    }
    if (answer === "now") return this.install();
    if (enforcementHours) {
      this.enforcementArmed = true;
      this.armEnforcement(this.firstDownloadedAt + enforcementHours * 3600_000);
    }
  }
}
