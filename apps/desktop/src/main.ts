/**
 * Pista desktop shell (Electron).
 *
 * - Dev (`PISTA_DEV_URL` set): loads the Vite dev server; the host runs from `pnpm dev`.
 * - Packaged: spawns the bundled agent host with Electron's own Node runtime on a free
 *   port, waits for it, and loads the UI that the host serves.
 * - Implements the UI's DesktopBrowserBridge with a WebContentsView (real Chromium),
 *   so the agent can read, script and screenshot any page.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage, shell, WebContentsView } from "electron";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { createLoginFill, LOGIN_WORLD_ID } from "./login-fill.js";
import { createLoginVault, safeStorageCrypto } from "./logins.js";
import { neutralizePaneDragRegions } from "./pane-drag.js";
import { parseHealth, resolveUpdaterConfig, UpdateController, type UpdaterLike } from "./updater-core.js";

const DEV_URL = process.env.PISTA_DEV_URL;
const CLIENT_HOME = process.env.PISTA_HOME ?? path.join(homedir(), ".pista");

let mainWindow: BrowserWindow | null = null;
let hostProcess: ChildProcess | null = null;

// ---------------------------------------------------------------------------
// Agent host
// ---------------------------------------------------------------------------

/** Apps launched from Finder get a minimal PATH; agents need the user's real one (node, git, CLIs). */
function loginShellPath(): string | undefined {
  if (process.platform === "win32") return undefined;
  try {
    const shellPath = process.env.SHELL ?? "/bin/zsh";
    const out = execFileSync(shellPath, ["-ilc", 'printf "__PATH__%s__PATH__" "$PATH"'], { timeout: 5000, encoding: "utf8" });
    return out.match(/__PATH__(.*)__PATH__/)?.[1];
  } catch {
    return undefined;
  }
}

function freePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => {
      const fallback = createServer();
      fallback.listen(0, "127.0.0.1", () => {
        const port = (fallback.address() as { port: number }).port;
        fallback.close(() => resolve(port));
      });
    });
    server.listen(preferred, "127.0.0.1", () => server.close(() => resolve(preferred)));
  });
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function startHost(): Promise<string> {
  const port = await freePort(4417);
  const resources = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../build");
  const entry = path.join(resources, "host", "dist", "host.mjs");
  mkdirSync(CLIENT_HOME, { recursive: true });
  const log = createWriteStream(path.join(CLIENT_HOME, "host.log"), { flags: "a" });

  // A packaged build may ship llama-server (see scripts/fetch-llama.mjs); the host only learns of it through this variable.
  const bundledLlama = path.join(resources, "llama");
  const llamaEnv = app.isPackaged && existsSync(bundledLlama) ? { PISTA_LLAMA_BUNDLE_DIR: bundledLlama } : {};

  hostProcess = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      PATH: loginShellPath() ?? process.env.PATH,
      ELECTRON_RUN_AS_NODE: "1",
      PISTA_HOST_PORT: String(port),
      PISTA_UI_DIR: path.join(resources, "ui"),
      PISTA_PARENT_PID: String(process.pid),
      PISTA_APP_VERSION: app.getVersion(),
      ...llamaEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  hostProcess.stdout?.pipe(log);
  hostProcess.stderr?.pipe(log);
  // The host's last stderr line is its fatal reason (for example a broken managed policy); show it in the error box.
  let lastError = "";
  hostProcess.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim().split("\n").filter(Boolean).pop();
    if (line) lastError = line.slice(0, 500);
  });
  hostProcess.on("exit", (code) => {
    if (code && !quitting) dialog.showErrorBox("Pista agent host stopped", `${lastError ? `${lastError}\n\n` : ""}Exit code ${code}. See ${path.join(CLIENT_HOME, "host.log")}.`);
  });

  const url = `http://127.0.0.1:${port}`;
  await waitFor(`${url}/health`, 20_000);
  return url;
}

// ---------------------------------------------------------------------------
// Auto-update (packaged macOS builds only; policy in docs/ENTERPRISE.md)
// ---------------------------------------------------------------------------

async function startUpdater(hostUrl: string) {
  const log = (msg: string) => console.log(`[updater] ${msg}`);
  try {
    const health = parseHealth(await (await fetch(`${hostUrl}/health`, { signal: AbortSignal.timeout(5000) })).json());
    const config = resolveUpdaterConfig({
      isPackaged: app.isPackaged,
      platform: process.platform,
      hasAppUpdateYml: app.isPackaged && existsSync(path.join(process.resourcesPath, "app-update.yml")),
      summary: health.summary,
      gate: health.gate,
    });
    if (!config.enabled) return log(`off: ${config.reason}`);
    // Loaded lazily so dev, unpackaged and disabled runs never touch electron-updater.
    const { autoUpdater } = require("electron-updater") as { autoUpdater: UpdaterLike & { logger: unknown } };
    autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
    const show = (options: Electron.MessageBoxOptions) => (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options));
    new UpdateController({
      updater: autoUpdater,
      timers: {
        now: () => Date.now(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        setInterval: (fn, ms) => setInterval(fn, ms),
        unref: (h) => (h as NodeJS.Timeout).unref(),
      },
      log,
      prompt: {
        async askRestart({ version }) {
          const { response } = await show({ type: "info", message: `Pista ${version ?? ""} is ready to install`.replace("  ", " "), detail: "Restart Pista to finish updating.", buttons: ["Restart now", "Later"], defaultId: 0, cancelId: 1 });
          return response === 0 ? "now" : "later";
        },
        async forceRestart({ version }, seconds) {
          // The button or the countdown, whichever comes first; the controller installs once either way.
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, seconds * 1000);
            void show({ type: "info", message: `Pista ${version ?? ""} must be installed`.replace("  ", " "), detail: `Pista restarts automatically in ${seconds} seconds, as required by your organisation.`, buttons: ["Restart now"], defaultId: 0 }).then(() => {
              clearTimeout(timer);
              resolve();
            });
          });
        },
      },
    }).start(config);
  } catch (error) {
    log(`not started: ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Browser view (implements DesktopBrowserBridge from apps/ui/src/browser/bridge.ts)
// ---------------------------------------------------------------------------

interface LoadError {
  code: number;
  description: string;
  url: string;
}

interface DownloadResult {
  bytes: number;
  contentType?: string;
  url: string;
  urlChain: string[];
}

interface DownloadRequest {
  path: string;
  taken: boolean;
  started: Promise<void>;
  markStarted: () => void;
  item?: Electron.DownloadItem;
  expiry?: NodeJS.Timeout;
  result: Promise<DownloadResult>;
  finish: (r: DownloadResult) => void;
  fail: (e: Error) => void;
}

class BrowserPane {
  /** Electron renders failed loads as a blank page, so failures are reported to the UI. */
  private error: LoadError | undefined;
  private visible = false;
  readonly view = new WebContentsView({
    webPreferences: { partition: "persist:pista-browser", sandbox: true, contextIsolation: true },
  });

  constructor(private window: BrowserWindow) {
    window.contentView.addChildView(this.view);
    this.view.setVisible(false);
    // The native view is square by default and would cover the workspace card's
    // rounded corners: 12px card radius minus its 1px border.
    this.view.setBorderRadius(11);
    neutralizePaneDragRegions(this.view.webContents);
    const wc = this.view.webContents;
    this.hookDownloads();
    // Popups and target=_blank stay in the pane instead of spawning windows.
    wc.setWindowOpenHandler(({ url }) => {
      void wc.loadURL(url);
      return { action: "deny" };
    });
    for (const event of ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-stop-loading"] as const) {
      wc.on(event as "did-navigate", () => this.emitState());
    }
    wc.on("did-start-loading", () => {
      this.error = undefined;
      this.emitState();
    });
    wc.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      // -3 is ERR_ABORTED: a navigation superseded by another one, not a failure.
      if (!isMainFrame || code === -3) return;
      this.error = { code, description, url };
      this.emitState();
    });
  }

  state() {
    const wc = this.view.webContents;
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      error: this.error,
    };
  }

  private emitState() {
    if (!this.window.isDestroyed()) this.window.webContents.send("browser:state", this.state());
  }

  setBounds(rect: { x: number; y: number; width: number; height: number } | null) {
    this.visible = Boolean(rect && rect.width >= 1 && rect.height >= 1);
    if (!rect || !this.visible) {
      this.view.setVisible(false);
      return;
    }
    this.view.setBounds({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
    this.view.setVisible(true);
  }

  async navigate(url: string) {
    try {
      await this.view.webContents.loadURL(url);
    } catch {
      /* aborted or failed loads still update state; the page shows Chromium's error */
    }
  }

  async readText(maxChars: number): Promise<string> {
    const text = await this.view.webContents.executeJavaScript("document.body ? document.body.innerText : ''", true);
    return String(text).slice(0, maxChars);
  }

  async screenshot() {
    let image = await this.view.webContents.capturePage();
    const { width } = image.getSize();
    if (width > 1440) image = image.resize({ width: 1440 });
    return { data: image.toJPEG(80).toString("base64"), mimeType: "image/jpeg" };
  }

  evaluate(script: string) {
    return this.view.webContents.executeJavaScript(script, true);
  }

  /** The one armed download, if any. Downloads that start while nothing is armed are cancelled. */
  private armed: DownloadRequest | undefined;

  /** A page must not write files unasked: only an armed request takes a download, anything else is cancelled. */
  private hookDownloads() {
    this.view.webContents.session.on("will-download", (_event, item) => {
      const armed = this.armed;
      if (!armed || armed.taken) return item.cancel();
      armed.taken = true;
      armed.item = item;
      armed.markStarted();
      item.setSavePath(armed.path);
      item.once("done", (_e, state) =>
        state === "completed" ? armed.finish({ bytes: item.getReceivedBytes(), contentType: item.getMimeType() || undefined, url: item.getURL(), urlChain: item.getURLChain() }) : armed.fail(new Error(`download failed: ${state}`)),
      );
    });
  }

  armDownload(savePath: string, url?: string) {
    if (!path.isAbsolute(savePath)) throw new Error("download failed: the path must be absolute");
    if (this.armed) throw new Error("another download is in progress");
    const request = {} as DownloadRequest;
    request.path = savePath;
    request.taken = false;
    request.started = new Promise<void>((resolve) => (request.markStarted = resolve));
    request.result = new Promise((resolve, reject) => ((request.finish = resolve), (request.fail = reject)));
    request.result.catch(() => undefined);
    this.armed = request;
    // An arm nobody waits for must not capture a later stray download.
    request.expiry = setTimeout(() => {
      if (this.armed === request) this.armed = undefined;
    }, 90_000);
    if (url) this.view.webContents.downloadURL(url);
  }

  /** Resolves when the armed download completed; the request is disarmed either way. */
  async waitDownload() {
    const request = this.armed;
    if (!request) throw new Error("download failed: the download request expired or was never armed");
    const limit = (ms: number, message: string) => new Promise<never>((_, reject) => (timers.push(setTimeout(() => reject(new Error(message)), ms))));
    const timers: NodeJS.Timeout[] = [];
    try {
      await Promise.race([request.started, limit(15_000, "no download started within 15 s")]);
      return await Promise.race([request.result, limit(60_000, "download failed: not finished within 60 s").catch((e) => (request.item?.cancel(), Promise.reject(e)))]);
    } finally {
      timers.forEach(clearTimeout);
      clearTimeout(request.expiry);
      if (this.armed === request) this.armed = undefined;
    }
  }

  /**
   * Trusted input (isTrusted events), so sites that ignore synthetic DOM events still react.
   * Hit-testing needs a laid-out view, so a hidden pane reports false and the UI falls back
   * to DOM events.
   */
  async input(event: NativeInput): Promise<boolean> {
    if (!this.visible) return false;
    const wc = this.view.webContents;
    if (event.type === "click") {
      const zoom = wc.getZoomFactor();
      const x = Math.round(event.x * zoom);
      const y = Math.round(event.y * zoom);
      wc.sendInputEvent({ type: "mouseMove", x, y });
      wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
      wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
      return true;
    }
    if (event.type === "text") {
      await wc.insertText(event.text);
      return true;
    }
    const parts = event.key.split("+");
    const key = KEY_NAMES[parts.at(-1)!] ?? parts.at(-1)!;
    const modifiers = parts.slice(0, -1).map((m) => MODIFIERS[m.toLowerCase()] ?? m.toLowerCase()) as Electron.KeyboardInputEvent["modifiers"];
    wc.sendInputEvent({ type: "keyDown", keyCode: key, modifiers });
    // Enter and printable keys also need a char event to submit forms / insert text.
    if (key === "Enter") wc.sendInputEvent({ type: "char", keyCode: "\r", modifiers });
    else if (key.length === 1) wc.sendInputEvent({ type: "char", keyCode: key, modifiers });
    wc.sendInputEvent({ type: "keyUp", keyCode: key, modifiers });
    return true;
  }
}

type NativeInput = { type: "click"; x: number; y: number } | { type: "text"; text: string } | { type: "key"; key: string };

/** DOM `KeyboardEvent.key` names → Electron accelerator key codes. */
const KEY_NAMES: Record<string, string> = {
  ArrowDown: "Down",
  ArrowUp: "Up",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  " ": "Space",
  Esc: "Escape",
  Return: "Enter",
};
const MODIFIERS: Record<string, string> = { ctrl: "control", cmd: "meta", command: "meta", option: "alt" };

function registerBrowserIpc(pane: BrowserPane) {
  ipcMain.on("browser:setBounds", (_e, rect) => pane.setBounds(rect));
  ipcMain.handle("browser:navigate", (_e, url: string) => pane.navigate(url));
  ipcMain.handle("browser:back", () => pane.view.webContents.navigationHistory.goBack());
  ipcMain.handle("browser:forward", () => pane.view.webContents.navigationHistory.goForward());
  ipcMain.handle("browser:reload", () => pane.view.webContents.reload());
  ipcMain.handle("browser:state", () => pane.state());
  ipcMain.handle("browser:readText", (_e, maxChars: number) => pane.readText(maxChars));
  ipcMain.handle("browser:screenshot", () => pane.screenshot());
  ipcMain.handle("browser:evaluate", (_e, script: string) => pane.evaluate(script));
  ipcMain.handle("browser:armDownload", (_e, p: string, url?: string) => pane.armDownload(p, url));
  // Failures travel as a value so Electron does not log an unhandled handler error; the preload rethrows them.
  ipcMain.handle("browser:waitDownload", () => pane.waitDownload().catch((e: Error) => ({ error: e.message })));
  ipcMain.handle("browser:input", (_e, event: NativeInput) => pane.input(event));
  ipcMain.on("browser:openDevTools", () => pane.view.webContents.openDevTools({ mode: "detach" }));
}

const LOGIN_CHANNELS = ["logins:status", "logins:list", "logins:save", "logins:remove", "logins:fill"];

function registerLoginIpc(pane: BrowserPane, owner: Electron.WebContents) {
  const vault = createLoginVault({ file: path.join(app.getPath("userData"), "logins.json"), crypto: safeStorageCrypto(safeStorage) });
  const wc = pane.view.webContents;
  const fill = createLoginFill({
    vault,
    pane: {
      getURL: () => wc.getURL(),
      runInPage: (code) => wc.executeJavaScriptInIsolatedWorld(LOGIN_WORLD_ID, [{ code }]),
      insertText: (text) => wc.insertText(text),
      // Per the sendInputEvent docs: keyDown/keyUp carry the key name, char carries the character.
      // Verified live in a later slice.
      pressEnter: async () => {
        wc.focus();
        wc.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
        wc.sendInputEvent({ type: "char", keyCode: "\r" });
        wc.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
      },
      onNavigate: (cb) => {
        // did-navigate is main-frame only; did-navigate-in-page also fires for subframes, which are ignored.
        const onMain = (_e: unknown, url: string) => cb(url);
        const onInPage = (_e: unknown, url: string, isMainFrame: boolean) => {
          if (isMainFrame) cb(url);
        };
        wc.on("did-navigate", onMain);
        wc.on("did-navigate-in-page", onInPage);
        return () => {
          wc.removeListener("did-navigate", onMain);
          wc.removeListener("did-navigate-in-page", onInPage);
        };
      },
    },
  });
  // Only the app UI may reach the vault; pages loaded in the browser pane must not.
  const guarded = (channel: string, run: (...args: any[]) => Promise<unknown>) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (event.sender !== owner || event.senderFrame !== owner.mainFrame) return { error: "not allowed" };
      // Failures travel as values (like waitDownload); messages here never contain secrets.
      return Promise.resolve()
        .then(() => run(...args))
        .catch((e: Error) => ({ error: e.message }));
    });
  guarded("logins:status", () => vault.status());
  guarded("logins:list", () => vault.list());
  guarded("logins:save", (input) => vault.save(input));
  guarded("logins:remove", (id: string) => vault.remove(String(id)));
  guarded("logins:fill", (site: string) => fill.fill(String(site)));
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

async function createWindow() {
  const uiUrl = DEV_URL ?? (await startHost());
  if (!DEV_URL) void startUpdater(uiUrl);
  if (DEV_URL) await waitFor(DEV_URL, 60_000);

  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Pista",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#262626" : "#ececec",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow = win;

  const pane = new BrowserPane(win);
  registerBrowserIpc(pane);
  registerLoginIpc(pane, win.webContents);

  // Links opened from the app UI (docs, OAuth sign-in) go to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    mainWindow = null;
    for (const channel of ["browser:navigate", "browser:back", "browser:forward", "browser:reload", "browser:state", "browser:readText", "browser:screenshot", "browser:evaluate", "browser:input", "browser:armDownload", "browser:waitDownload", ...LOGIN_CHANNELS])
      ipcMain.removeHandler(channel);
    ipcMain.removeAllListeners("browser:setBounds");
    ipcMain.removeAllListeners("browser:openDevTools");
  });
  await win.loadURL(uiUrl);
}

ipcMain.handle("shell:openExternal", (_e, url: string) => {
  if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
});
ipcMain.handle("dialog:pickFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

let quitting = false;
app.on("before-quit", () => {
  quitting = true;
  hostProcess?.kill();
});

app.whenReady().then(async () => {
  app.setName("Pista");
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
  try {
    await createWindow();
  } catch (error) {
    dialog.showErrorBox("Pista could not start", (error as Error).message);
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
