import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, win32 } from "node:path";
import { promisify } from "node:util";
import { downloadFile, freePort, ManagedProcess, ProcessStoppedError } from "@pista/local-runtime";
import type { LlamaRuntimeStatus } from "@pista/protocol";
import llamaBuild from "./llama-build.json";

const run = promisify(execFile);

export type LlamaVariant = "metal" | "vulkan" | "cpu";
export interface LlamaAsset {
  url: string;
  size: number;
  sha256: string;
  variant: LlamaVariant;
  /** Path of llama-server inside the extracted archive, forward slashes. */
  binaryPath: string;
}
export interface LlamaBuild {
  tag: string;
  /** Keyed by `<process.platform>-<process.arch>`; each list is in preference order (vulkan before cpu). */
  assets: Record<string, LlamaAsset[]>;
}

/**
 * The llama.cpp release Pista installs, kept in llama-build.json so the desktop packaging script reads the same pin.
 * Hashes were checked against GitHub's `assets[].digest`.
 */
const VARIANTS: readonly string[] = ["metal", "vulkan", "cpu"];
function parseBuild(raw: { tag: string; assets: Record<string, unknown[]> }): LlamaBuild {
  for (const [platform, list] of Object.entries(raw.assets)) {
    for (const a of list as Partial<LlamaAsset>[]) {
      if (!a.variant || !VARIANTS.includes(a.variant) || !a.url || !a.sha256 || !a.binaryPath || typeof a.size !== "number") {
        throw new Error(`llama-build.json: invalid asset for ${platform}`);
      }
    }
  }
  return raw as LlamaBuild;
}
export const LLAMA_BUILDS: LlamaBuild = parseBuild(llamaBuild);

export type ArchiveKind = "tar.gz" | "zip";
export function archiveKind(url: string): ArchiveKind {
  return url.endsWith(".zip") ? "zip" : "tar.gz";
}

/** The asset to install: `requested` (PISTA_LLAMA_VARIANT) if the platform has it, else the first usable one in preference order. Vulkan counts as usable only with a Vulkan loader present. */
export function selectLlamaAsset(build: LlamaBuild, platformKey: string, opts: { requested?: string; hasVulkan: boolean }): LlamaAsset | undefined {
  const assets = build.assets[platformKey] ?? [];
  const requested = opts.requested?.trim().toLowerCase();
  return (requested ? assets.find((a) => a.variant === requested) : undefined) ?? assets.find((a) => a.variant !== "vulkan" || opts.hasVulkan);
}

/** Cheap probe for a Vulkan loader: file existence only, no subprocess. */
export function detectVulkan(platform: string, exists: (path: string) => boolean = existsSync, env: NodeJS.ProcessEnv = process.env): boolean {
  if (platform === "win32") return exists(win32.join(env.SystemRoot ?? "C:\\Windows", "System32", "vulkan-1.dll")); // SysWOW64 holds the 32-bit loader
  if (platform === "linux") {
    return ["/usr/lib", "/usr/lib64", "/usr/lib/x86_64-linux-gnu", "/usr/lib/aarch64-linux-gnu", "/usr/local/lib"].some((dir) => exists(`${dir}/libvulkan.so.1`));
  }
  return false;
}

/** How to unpack an archive. Windows 10+ ships a bsdtar that reads zip, called by full path so a GNU tar earlier on PATH (Git for Windows) is not used. Zip assets exist only for Windows; elsewhere a zip is an error rather than a hidden `unzip` dependency. */
export function extractCommand(kind: ArchiveKind, platform: string, archive: string, dest: string, systemRoot?: string): { cmd: string; args: string[] } {
  if (kind === "tar.gz") return { cmd: "tar", args: ["-xzf", archive, "-C", dest] };
  if (platform !== "win32") throw new Error("zip archives are only supported on Windows");
  return { cmd: win32.join(systemRoot ?? "C:\\Windows", "System32", "tar.exe"), args: ["-xf", archive, "-C", dest] };
}

const CHILD_ENV_KEYS = ["PATH", "HOME", "TMPDIR", "LANG"];
const CHILD_ENV_KEYS_WIN32 = ["SystemRoot", "windir", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "ProgramData", "PATHEXT", "COMSPEC"];

/** The allow-list of host environment variables llama-server inherits. Keys match case-insensitively (Windows has `Path`). */
export function filterChildEnv(env: NodeJS.ProcessEnv, platform: string): NodeJS.ProcessEnv {
  const allowed = new Set([...CHILD_ENV_KEYS, ...(platform === "win32" ? CHILD_ENV_KEYS_WIN32 : [])].map((k) => k.toLowerCase()));
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && (allowed.has(key.toLowerCase()) || key.startsWith("LC_"))) out[key] = value;
  }
  return out;
}

/**
 * Written once if missing; users may edit it. Applies to every model the router loads.
 * `c = 32768` because Pista's fixed prompt prefix (system prompt plus tool schemas) is about 13k tokens
 * and the Pi SDK keeps 4k tokens of safety on top; with 16k there is no room left for a reply.
 */
export const DEFAULT_MODELS_INI = `version = 1

[*]
c = 32768
np = 1
reasoning-format = deepseek
`;

/** The default before the 32k bump. A file that still matches it byte for byte was never edited and is upgraded. */
export const OLD_DEFAULT_MODELS_INI = `version = 1

[*]
c = 16384
np = 1
reasoning-format = deepseek
`;

/** Creates models.ini, or upgrades it when it is still the untouched old default. Anything else is the user's and stays. */
export function ensureModelsIni(path: string): void {
  if (!existsSync(path)) writeFileSync(path, DEFAULT_MODELS_INI);
  else if (readFileSync(path, "utf8") === OLD_DEFAULT_MODELS_INI) writeFileSync(path, DEFAULT_MODELS_INI);
}

export type LlamaMode = "managed" | "external" | "off";

/** PISTA_LLAMA_RUNTIME: managed (default; install and run llama-server), external (use LLAMA_BASE_URL) or off. */
export function llamaMode(env: NodeJS.ProcessEnv = process.env): LlamaMode {
  const value = env.PISTA_LLAMA_RUNTIME?.trim().toLowerCase();
  return value === "external" || value === "off" ? value : "managed";
}

export function llamaPlatformKey(platform: string = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`;
}

const DEFAULT_IDLE_MS = 30 * 60_000;
const DEFAULT_EXTERNAL_URL = "http://127.0.0.1:8080";

export interface LlamaRuntimeOptions {
  /** `$PISTA_HOME/llama`. */
  home: string;
  onStatus?: (status: LlamaRuntimeStatus) => void;
  env?: NodeJS.ProcessEnv;
  /** Directory expected to contain `<tag>/llama-server` (PISTA_LLAMA_BUNDLE_DIR, set by the desktop shell). Preferred over the download. */
  bundleDir?: string;
  /** Tests only. */
  build?: LlamaBuild;
  platformKey?: string;
  /** Tests only: skips the Vulkan probe. */
  hasVulkan?: boolean;
}

/**
 * Installs a pinned llama.cpp release on opt-in and runs `llama-server` in router mode on loopback.
 * Layout under `home`: downloads/, bin/<tag>/, cache/ (LLAMA_CACHE and HF_HOME: models downloaded from Hugging Face, hub layout),
 * models/ (--models-dir: GGUF files the user places there), models.ini, installed.json.
 */
export class LlamaRuntime {
  readonly mode: LlamaMode;
  private env: NodeJS.ProcessEnv;
  private build: LlamaBuild;
  private platform: string;
  private selected: LlamaAsset | undefined;
  private port: number | undefined;
  /** The install callers share, and what status() reports. disable() clears it at once. */
  private installing: Promise<void> | undefined;
  /** The install work actually in flight; it outlives disable() until it has unwound. */
  private inflight: Promise<void> | undefined;
  /** Bumped by disable(); a start that began under an older epoch must not go on to run the server. */
  private epoch = 0;
  private abort: AbortController | undefined;
  private progress: { bytes: number; total?: number } | undefined;
  private error: string | undefined;
  private proc: ManagedProcess;

  constructor(private options: LlamaRuntimeOptions) {
    this.env = options.env ?? process.env;
    this.mode = llamaMode(this.env);
    this.build = options.build ?? LLAMA_BUILDS;
    this.platform = options.platformKey ?? llamaPlatformKey();
    this.selected = selectLlamaAsset(this.build, this.platform, { requested: this.env.PISTA_LLAMA_VARIANT, hasVulkan: options.hasVulkan ?? detectVulkan(process.platform, existsSync, this.env) });
    const idle = Number(this.env.PISTA_LLAMA_IDLE_MS);
    this.proc = new ManagedProcess({
      name: "llama-server",
      readyTimeoutMs: 60_000,
      idleMs: idle > 0 ? idle : DEFAULT_IDLE_MS,
      launch: () => this.launch(),
      onStateChange: () => this.emit(),
      // Runs before the "stopped" state change is emitted, so listeners see the error, not a flicker of "installed".
      onExit: ({ code, signal, stderrTail }) => {
        this.error = `llama-server exited unexpectedly (${signal ?? code}). ${stderrTail.split("\n").slice(-3).join(" ")}`.trim();
      },
    });
  }

  get paths() {
    const { home } = this.options;
    return {
      downloads: join(home, "downloads"),
      bin: join(home, "bin", this.build.tag),
      binRoot: join(home, "bin"),
      models: join(home, "models"),
      cache: join(home, "cache"),
      ini: join(home, "models.ini"),
      installed: join(home, "installed.json"),
    };
  }

  private get asset(): LlamaAsset | undefined {
    return this.selected;
  }

  get variant(): LlamaVariant | undefined {
    return this.selected?.variant;
  }

  /** Why enabling cannot work here, if it cannot. */
  get unavailable(): string | undefined {
    if (this.mode === "off") return "disabled by PISTA_LLAMA_RUNTIME=off";
    if (this.mode === "managed" && !this.asset) return `No llama.cpp build is available for ${this.platform}; set PISTA_LLAMA_RUNTIME=external and LLAMA_BASE_URL to use your own server.`;
    return undefined;
  }

  /** Router URL (no `/v1`) when it is reachable. */
  get baseUrl(): string | undefined {
    if (this.mode === "external") return (this.env.LLAMA_BASE_URL?.trim() || DEFAULT_EXTERNAL_URL).replace(/\/+$/, "");
    return this.proc.state === "running" && this.port ? `http://127.0.0.1:${this.port}` : undefined;
  }

  /** The bundled llama-server for the pinned tag, if the app shipped one. A bundle of another tag is ignored. */
  private bundledBinary(): string | undefined {
    const dir = this.options.bundleDir;
    if (!dir) return undefined;
    const path = join(dir, this.build.tag, process.platform === "win32" ? "llama-server.exe" : "llama-server");
    return existsSync(path) ? path : undefined;
  }

  /** Absolute path of llama-server: the bundled one when it matches the pinned tag, else the selected build's binary inside bin/<tag>. */
  binaryPath(): string | undefined {
    const bundled = this.bundledBinary();
    if (bundled) return bundled;
    if (!this.asset) return undefined;
    const path = join(this.paths.bin, ...this.asset.binaryPath.split("/"));
    return existsSync(path) ? path : undefined;
  }

  isInstalled(): boolean {
    if (this.bundledBinary()) return true;
    try {
      const meta = JSON.parse(readFileSync(this.paths.installed, "utf8")) as { tag?: string; platform?: string; variant?: string };
      // installed.json written before variants existed is a macOS arm64 install, which only ever had the Metal build.
      const legacyMetal = meta.variant === undefined && this.platform === "darwin-arm64" && this.variant === "metal";
      return meta.tag === this.build.tag && meta.platform === this.platform && (meta.variant === this.variant || legacyMetal) && this.binaryPath() !== undefined;
    } catch {
      return false;
    }
  }

  /** Where the managed binary comes from, as a spreadable fragment so the field is absent when there is no binary or the mode is not managed. */
  private source(): Pick<LlamaRuntimeStatus, "source"> {
    if (this.mode !== "managed") return {}; // external and off do not use a binary Pista manages
    if (this.bundledBinary()) return { source: "bundled" };
    return this.isInstalled() ? { source: "downloaded" } : {};
  }

  status(): LlamaRuntimeStatus {
    const base = { mode: this.mode, build: this.build.tag, platform: this.platform, variant: this.mode === "managed" ? this.variant : undefined, ...this.source() };
    if (this.mode === "off") return { ...base, state: "not-installed", message: this.unavailable };
    if (this.mode === "external") return { ...base, state: "running", baseUrl: this.baseUrl };
    if (!this.asset) return { ...base, state: "unsupported", message: this.unavailable };
    if (this.installing) return { ...base, state: "installing", progress: this.progress };
    if (this.proc.state === "running") return { ...base, state: "running", baseUrl: this.baseUrl };
    if (this.proc.state === "starting") return { ...base, state: "starting" };
    if (this.error) return { ...base, state: "error", message: this.error };
    return { ...base, state: this.isInstalled() ? "installed" : "not-installed" };
  }

  private emit() {
    this.options.onStatus?.(this.status());
  }

  /** Downloads and unpacks the pinned build. Idempotent; concurrent calls share one install. */
  install(): Promise<void> {
    if (this.unavailable) return Promise.reject(new Error(this.unavailable));
    if (this.mode === "external" || this.isInstalled()) return Promise.resolve();
    if (this.installing) return this.installing;
    const asset = this.asset!;
    const abort = (this.abort = new AbortController());
    this.error = undefined;
    this.progress = { bytes: 0, total: asset.size };
    const prior = this.inflight; // an install cancelled by disable() may still be unwinding; never overlap with it
    let promise!: Promise<void>; // the work below compares itself against it when it unwinds
    promise = (async () => {
      await prior?.catch(() => {});
      if (abort.signal.aborted) throw new ProcessStoppedError();
      const p = this.paths;
      const kind = archiveKind(asset.url);
      const archive = join(p.downloads, `${this.build.tag}-${this.platform}-${asset.variant}.${kind}`);
      let lastEmit = 0;
      try {
        mkdirSync(p.downloads, { recursive: true });
        await downloadFile({
          url: asset.url,
          dest: archive,
          size: asset.size,
          sha256: asset.sha256,
          signal: abort.signal,
          label: `llama.cpp ${this.build.tag}`,
          onProgress: (bytes) => {
            this.progress = { bytes, total: asset.size };
            const now = Date.now();
            if (now - lastEmit >= 250 || bytes >= asset.size) {
              lastEmit = now;
              this.emit();
            }
          },
        });
        rmSync(p.bin, { recursive: true, force: true });
        mkdirSync(p.bin, { recursive: true });
        const extract = extractCommand(kind, process.platform, archive, p.bin, this.env.SystemRoot);
        try {
          await run(extract.cmd, extract.args);
        } catch (error) {
          if (kind === "zip" && (error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Windows 10 1803 or newer is required (tar.exe missing).");
          throw error;
        }
        if (abort.signal.aborted) throw new ProcessStoppedError(); // disabled while unpacking: leave no installed.json
        const binary = this.binaryPath();
        if (!binary) throw new Error(`llama-server was not found in the llama.cpp ${this.build.tag} archive.`);
        if (process.platform !== "win32") chmodSync(binary, 0o755);
        writeFileSync(p.installed, JSON.stringify({ tag: this.build.tag, platform: this.platform, variant: asset.variant }));
        rmSync(archive, { force: true });
      } catch (error) {
        rmSync(p.bin, { recursive: true, force: true });
        rmSync(archive, { force: true });
        if (!abort.signal.aborted) this.error = `Installing llama.cpp failed: ${(error as Error).message}`;
        throw error;
      } finally {
        if (this.inflight === promise) this.inflight = undefined;
        if (this.installing === promise) {
          this.installing = undefined;
          this.abort = undefined;
          this.progress = undefined;
        }
        this.emit();
      }
    })();
    this.installing = this.inflight = promise;
    this.emit();
    return promise;
  }

  private async launch() {
    const binary = this.binaryPath();
    if (!binary) throw new Error("llama.cpp is not installed.");
    const p = this.paths;
    for (const dir of [p.models, p.cache]) mkdirSync(dir, { recursive: true });
    ensureModelsIni(p.ini);
    const port = (this.port = await freePort());
    this.error = undefined;
    return {
      command: binary,
      args: ["--host", "127.0.0.1", "--port", String(port), "--models-dir", p.models, "--models-preset", p.ini, "--models-max", "2", "--no-webui"],
      env: this.childEnv(),
      ready: { http: { url: `http://127.0.0.1:${port}/health` } },
    };
  }

  /** The child gets an allow-list, not the host's environment (which may hold API keys). Caches stay under the home dir. */
  private childEnv(): NodeJS.ProcessEnv {
    const env = filterChildEnv(this.env, process.platform);
    if (this.env.HF_TOKEN) env.HF_TOKEN = this.env.HF_TOKEN;
    env.LLAMA_CACHE = this.paths.cache;
    env.HF_HOME = join(this.paths.cache, "hf");
    env.XDG_CACHE_HOME = this.paths.cache; // some builds fall back to it, and HOME is passed through
    return env;
  }

  /** Installs if needed, starts the router if needed, and resolves with its base URL. Rejects when disabled or unsupported, or when install or start fails; errors also surface in `status()`. */
  async ensureRunning(): Promise<string> {
    if (this.mode === "external") return this.baseUrl!;
    const epoch = this.epoch;
    await this.install();
    if (epoch !== this.epoch) throw new ProcessStoppedError();
    try {
      await this.proc.ensureRunning();
    } catch (error) {
      if (!(error instanceof ProcessStoppedError)) {
        this.error = `llama-server did not start: ${(error as Error).message}`;
        this.emit();
      }
      throw error;
    }
    if (epoch !== this.epoch) {
      this.proc.stop();
      throw new ProcessStoppedError();
    }
    this.proc.armIdle();
    return this.baseUrl!;
  }

  /** Runs `fn` with the router URL, keeping the idle timer off while it runs. */
  async touch<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
    const url = await this.ensureRunning();
    this.proc.pauseIdle();
    try {
      return await fn(url);
    } finally {
      this.proc.armIdle();
    }
  }

  /** Re-arms the idle timer while the router is running; never starts it. For long-running work that bypasses `touch`. */
  keepAlive() {
    if (this.proc.state === "running") this.proc.armIdle();
  }

  stop() {
    this.proc.stop();
  }

  /** Stops the router and cancels a running install. */
  disable() {
    this.epoch++;
    this.abort?.abort();
    this.abort = this.installing = this.progress = undefined;
    this.error = undefined;
    this.stop();
    this.emit();
  }

  /** Deletes the binary and downloads. Models, cache and models.ini belong to the user and stay. */
  async remove() {
    this.disable();
    await this.inflight?.catch(() => {}); // let a cancelled install finish unwinding before deleting under it
    const p = this.paths;
    for (const path of [p.binRoot, p.downloads, p.installed]) rmSync(path, { recursive: true, force: true });
    this.emit();
  }
}
