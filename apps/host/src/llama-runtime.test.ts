import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { LlamaRuntimeStatus } from "@pista/protocol";
import { DEFAULT_MODELS_INI, OLD_DEFAULT_MODELS_INI, ensureModelsIni, LLAMA_BUILDS, LlamaRuntime, detectVulkan, extractCommand, filterChildEnv, llamaMode, llamaPlatformKey, selectLlamaAsset, type LlamaAsset, type LlamaBuild } from "./llama-runtime.ts";

const root = mkdtempSync(join(tmpdir(), "pista-llama-"));
after(() => rmSync(root, { recursive: true, force: true }));

describe("models.ini default", () => {
  it("gives replies room: 32k window, one slot, deepseek reasoning format", () => {
    assert.match(DEFAULT_MODELS_INI, /^c = 32768$/m);
    assert.match(DEFAULT_MODELS_INI, /^np = 1$/m);
    assert.match(DEFAULT_MODELS_INI, /^reasoning-format = deepseek$/m);
  });

  it("writes a missing file, upgrades only the untouched old default, keeps edits", () => {
    const dir = mkdtempSync(join(root, "ini-"));
    const path = join(dir, "models.ini");
    ensureModelsIni(path);
    assert.equal(readFileSync(path, "utf8"), DEFAULT_MODELS_INI);

    writeFileSync(path, OLD_DEFAULT_MODELS_INI);
    ensureModelsIni(path);
    assert.equal(readFileSync(path, "utf8"), DEFAULT_MODELS_INI, "untouched old default is upgraded");

    const edited = OLD_DEFAULT_MODELS_INI.replace("np = 1", "np = 2");
    writeFileSync(path, edited);
    ensureModelsIni(path);
    assert.equal(readFileSync(path, "utf8"), edited, "an edited file is left alone");

    const custom = "version = 1\n[*]\nc = 16384\n";
    writeFileSync(path, custom);
    ensureModelsIni(path);
    assert.equal(readFileSync(path, "utf8"), custom);
  });
});

// A fake release: llama-b1/llama-server is a node script that records its argv and LLAMA_CACHE, then answers /health.
const FAKE_SERVER = `#!${process.execPath}
const { writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
writeFileSync(args[args.indexOf("--models-dir") + 1] + "/../spawn.json", JSON.stringify({ args, cache: process.env.LLAMA_CACHE, env: process.env }));
require("node:http").createServer((req, res) => res.end('{"status":"ok"}')).listen(Number(args[args.indexOf("--port") + 1]), "127.0.0.1");
`;
let archive: Buffer;
let zipArchive: Buffer | undefined;
let requests = 0;
let tarballServer: Server;
let build: LlamaBuild;
let zipBuild: LlamaBuild | undefined;
const onPath = (cmd: string) => spawnSync(cmd, ["-v"], { stdio: "ignore" }).error === undefined;
const hasZip = onPath("zip"); // builds the fake archive
const zipSkip = !hasZip ? "zip is not on PATH" : process.platform !== "win32" ? "zip assets are only extracted on Windows" : false;
/** While set, the fake release server holds its response until the promise resolves. */
let hold: Promise<void> | undefined;
const made: LlamaRuntime[] = [];
after(() => made.forEach((r) => r.disable())); // a failed assertion must not leave a server running

before(async () => {
  const stage = join(root, "stage");
  mkdirSync(join(stage, "llama-b1"), { recursive: true });
  writeFileSync(join(stage, "llama-b1", "llama-server"), FAKE_SERVER, { mode: 0o644 }); // not executable: install must fix that
  execFileSync("tar", ["-czf", join(root, "fake.tar.gz"), "-C", stage, "llama-b1"]);
  archive = readFileSync(join(root, "fake.tar.gz"));
  if (hasZip) {
    // Flat like the real Windows assets: the binary sits at the zip root.
    execFileSync("zip", ["-q", "-r", join(root, "fake.zip"), "."], { cwd: join(stage, "llama-b1") });
    zipArchive = readFileSync(join(root, "fake.zip"));
  }
  tarballServer = createServer((req, res) => {
    requests++;
    const body = req.url?.endsWith(".zip") ? zipArchive : archive;
    void Promise.resolve(hold).then(() => res.end(body));
  });
  await new Promise<void>((resolve) => tarballServer.listen(0, "127.0.0.1", resolve));
  const { port } = tarballServer.address() as { port: number };
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  build = {
    tag: "b1",
    assets: { "test-x64": [{ url: `http://127.0.0.1:${port}/fake.tar.gz`, size: archive.length, sha256: sha(archive), variant: "cpu", binaryPath: "llama-b1/llama-server" }] },
  };
  if (zipArchive) {
    zipBuild = {
      tag: "b1",
      assets: { "test-x64": [{ url: `http://127.0.0.1:${port}/fake.zip`, size: zipArchive.length, sha256: sha(zipArchive), variant: "cpu", binaryPath: "llama-server" }] },
    };
  }
});
after(() => tarballServer.close());

let n = 0;
function make(env: NodeJS.ProcessEnv = {}, overrides: { build?: LlamaBuild; platformKey?: string; hasVulkan?: boolean; bundleDir?: string } = {}) {
  const home = join(root, `home${n++}`, "llama");
  const events: LlamaRuntimeStatus[] = [];
  const runtime = new LlamaRuntime({ home, env: { ...env }, build, platformKey: "test-x64", hasVulkan: false, ...overrides, onStatus: (s) => events.push(s) });
  made.push(runtime);
  return { runtime, home, events };
}

describe("llama runtime", () => {
  it("pins a hash-verified build for each supported platform", () => {
    assert.equal(LLAMA_BUILDS.tag, "b11552");
    assert.deepEqual(Object.keys(LLAMA_BUILDS.assets).sort(), ["darwin-arm64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]);
    for (const assets of Object.values(LLAMA_BUILDS.assets)) {
      for (const asset of assets) {
        assert.match(asset.url, /^https:\/\/github\.com\/ggml-org\/llama\.cpp\/releases\/download\/b11552\/llama-b11552-bin-/);
        assert.match(asset.sha256, /^[0-9a-f]{64}$/);
        assert.ok(asset.size > 0);
        assert.match(asset.binaryPath, asset.url.endsWith(".zip") ? /^llama-server\.exe$/ : /^llama-b11552\/llama-server$/);
      }
    }
    for (const key of ["win32-x64", "linux-x64"]) assert.deepEqual(LLAMA_BUILDS.assets[key].map((a) => a.variant), ["vulkan", "cpu"]);
    assert.equal(llamaPlatformKey("darwin", "arm64"), "darwin-arm64");
    const mac = new LlamaRuntime({ home: join(root, "x"), env: {}, platformKey: "darwin-arm64" });
    assert.equal(mac.status().state, "not-installed");
    assert.equal(mac.variant, "metal");
  });

  it("selects an asset by variant preference, Vulkan availability and PISTA_LLAMA_VARIANT", () => {
    const pick = (key: string, opts: { requested?: string; hasVulkan: boolean }) => selectLlamaAsset(LLAMA_BUILDS, key, opts)?.variant;
    assert.equal(pick("win32-x64", { hasVulkan: true }), "vulkan");
    assert.equal(pick("win32-x64", { hasVulkan: false }), "cpu");
    assert.equal(pick("linux-x64", { hasVulkan: true, requested: "cpu" }), "cpu");
    assert.equal(pick("linux-x64", { hasVulkan: false, requested: " Vulkan " }), "vulkan", "an explicit request wins over the probe");
    assert.equal(pick("linux-arm64", { hasVulkan: true, requested: "vulkan" }), "cpu");
    assert.equal(pick("win32-x64", { hasVulkan: true, requested: "bogus" }), "vulkan");
    assert.equal(pick("darwin-arm64", { hasVulkan: false }), "metal");
    assert.equal(pick("plan9-mips", { hasVulkan: true }), undefined);
    const none: LlamaAsset = { ...LLAMA_BUILDS.assets["linux-x64"][0] };
    assert.equal(selectLlamaAsset({ tag: "t", assets: { k: [none] } }, "k", { hasVulkan: false }), undefined, "nothing usable");
  });

  it("probes for a Vulkan loader without spawning anything", () => {
    assert.equal(detectVulkan("win32", (p) => p === "D:\\Win\\System32\\vulkan-1.dll", { SystemRoot: "D:\\Win" }), true);
    assert.equal(detectVulkan("win32", (p) => p.includes("SysWOW64")), false, "the 32-bit loader does not count");
    assert.equal(detectVulkan("win32", () => false), false);
    assert.equal(detectVulkan("linux", (p) => p === "/usr/lib/x86_64-linux-gnu/libvulkan.so.1"), true);
    assert.equal(detectVulkan("linux", () => false), false);
    assert.equal(detectVulkan("darwin", () => true), false);
  });

  it("chooses the extraction command by archive kind and platform", () => {
    assert.deepEqual(extractCommand("tar.gz", "linux", "a.tar.gz", "d"), { cmd: "tar", args: ["-xzf", "a.tar.gz", "-C", "d"] });
    assert.deepEqual(extractCommand("tar.gz", "win32", "a.tar.gz", "d"), { cmd: "tar", args: ["-xzf", "a.tar.gz", "-C", "d"] });
    assert.deepEqual(extractCommand("zip", "win32", "a.zip", "d", "D:\\Win"), { cmd: "D:\\Win\\System32\\tar.exe", args: ["-xf", "a.zip", "-C", "d"] });
    assert.equal(extractCommand("zip", "win32", "a.zip", "d").cmd, "C:\\Windows\\System32\\tar.exe");
    assert.throws(() => extractCommand("zip", "darwin", "a.zip", "d"), /only supported on Windows/);
    assert.throws(() => extractCommand("zip", "linux", "a.zip", "d"), /only supported on Windows/);
  });

  it("reports unsupported platforms without downloading", async () => {
    const { runtime } = make({}, { platformKey: "plan9-mips" });
    const before = requests;
    assert.equal(runtime.status().state, "unsupported");
    assert.match(runtime.status().message ?? "", /plan9-mips/);
    await assert.rejects(runtime.ensureRunning(), /No llama\.cpp build/);
    assert.equal(requests, before);
  });

  it("lays out paths under the home dir", () => {
    const { runtime, home } = make();
    const p = runtime.paths;
    assert.deepEqual(
      [p.downloads, p.bin, p.models, p.cache, p.ini, p.installed],
      ["downloads", join("bin", "b1"), "models", "cache", "models.ini", "installed.json"].map((x) => join(home, x)),
    );
  });

  /** A bundle directory like Resources/llama: <tag>/llama-server (a node script, so it can run). */
  function makeBundle(tag: string) {
    const dir = join(root, `bundle${n++}`);
    mkdirSync(join(dir, tag), { recursive: true });
    writeFileSync(join(dir, tag, "llama-server"), FAKE_SERVER, { mode: 0o755 });
    return dir;
  }

  it("prefers the bundled binary and never downloads", async () => {
    const bundleDir = makeBundle(build.tag);
    const { runtime, home } = make({}, { bundleDir });
    assert.equal(runtime.binaryPath(), join(bundleDir, build.tag, "llama-server"));
    assert.equal(runtime.isInstalled(), true);
    assert.equal(runtime.status().state, "installed");
    assert.equal(runtime.status().source, "bundled");
    const before = requests;
    await runtime.install();
    assert.equal(requests, before);
    assert.ok(!existsSync(join(home, "bin")) && !existsSync(runtime.paths.installed));
    const url = await runtime.ensureRunning();
    assert.equal(runtime.status().state, "running");
    assert.equal(requests, before);
    assert.ok(url.startsWith("http://127.0.0.1:"));
    runtime.disable();
  });

  it("falls back to the download when the bundle holds another tag", async () => {
    const bundleDir = makeBundle("b0");
    const { runtime } = make({}, { bundleDir });
    assert.equal(runtime.binaryPath(), undefined);
    assert.equal(runtime.isInstalled(), false);
    assert.equal(runtime.status().state, "not-installed");
    assert.equal(runtime.status().source, undefined);
    const before = requests;
    await runtime.install();
    assert.equal(requests, before + 1);
    assert.equal(runtime.status().source, "downloaded");
    assert.ok(runtime.binaryPath()?.startsWith(runtime.paths.bin));
  });

  it("remove() leaves the bundle alone", async () => {
    const bundleDir = makeBundle(build.tag);
    const { runtime } = make({}, { bundleDir });
    await runtime.remove();
    assert.ok(existsSync(join(bundleDir, build.tag, "llama-server")));
    assert.equal(runtime.isInstalled(), true);
  });

  it("installs, starts on loopback, and keeps models.ini across restarts", async () => {
    const { runtime, home, events } = make();
    const before = requests;
    await runtime.install();
    assert.equal(requests, before + 1);
    assert.equal(runtime.status().state, "installed");
    assert.deepEqual(JSON.parse(readFileSync(runtime.paths.installed, "utf8")), { tag: "b1", platform: "test-x64", variant: "cpu" });
    assert.ok(existsSync(join(runtime.paths.bin, "llama-b1", "llama-server")));
    assert.deepEqual(readdirSync(runtime.paths.downloads), [], "archive removed");
    assert.ok(events.some((e) => e.state === "installing"));

    await runtime.install(); // idempotent: no second download
    assert.equal(requests, before + 1);

    const url = await runtime.ensureRunning();
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(runtime.status().state, "running");
    assert.equal(runtime.status().baseUrl, url);
    assert.equal((await fetch(`${url}/health`)).status, 200);
    const spawned = JSON.parse(readFileSync(join(home, "spawn.json"), "utf8")) as { args: string[]; cache: string };
    assert.deepEqual(spawned.args.slice(0, 2), ["--host", "127.0.0.1"]);
    assert.deepEqual(spawned.args.slice(4), ["--models-dir", runtime.paths.models, "--models-preset", runtime.paths.ini, "--models-max", "2", "--no-webui"]);
    assert.equal(spawned.cache, runtime.paths.cache);
    assert.equal(readFileSync(runtime.paths.ini, "utf8"), DEFAULT_MODELS_INI);

    runtime.stop();
    assert.equal(runtime.status().state, "installed");
    writeFileSync(runtime.paths.ini, "version = 1\n[*]\nc = 4096\n");
    await runtime.ensureRunning();
    assert.equal(readFileSync(runtime.paths.ini, "utf8"), "version = 1\n[*]\nc = 4096\n", "user edits survive");

    await runtime.remove();
    assert.equal(runtime.status().state, "not-installed");
    assert.ok(!existsSync(join(home, "bin")) && !existsSync(runtime.paths.installed));
    assert.ok(existsSync(runtime.paths.models) && existsSync(runtime.paths.cache) && existsSync(runtime.paths.ini), "models, cache and models.ini are kept");
  });

  it("installs a flat zip archive", { skip: zipSkip }, async () => {
    const { runtime } = make({}, { build: zipBuild });
    await runtime.install();
    assert.equal(runtime.status().state, "installed");
    assert.equal(runtime.status().variant, "cpu");
    assert.ok(existsSync(join(runtime.paths.bin, "llama-server")));
    assert.deepEqual(JSON.parse(readFileSync(runtime.paths.installed, "utf8")), { tag: "b1", platform: "test-x64", variant: "cpu" });
    assert.deepEqual(readdirSync(runtime.paths.downloads), [], "archive removed");
  });

  it("the win32 zip command shape (tar -xf) unpacks the fake zip", { skip: hasZip && process.platform === "darwin" ? false : "needs zip and macOS (bsdtar, as Windows ships)" }, () => {
    const dest = join(root, "bsdtar-out");
    mkdirSync(dest);
    const { cmd, args } = extractCommand("zip", "win32", join(root, "fake.zip"), dest, "/unused");
    execFileSync("tar", args); // the real command is <SystemRoot>\\System32\\tar.exe; plain tar is the same bsdtar here
    assert.ok(cmd.endsWith("tar.exe") && existsSync(join(dest, "llama-server")));
  });

  it("filters the child environment case-insensitively, with extras on Windows", () => {
    const env = { Path: "p", SystemRoot: "C:\\Windows", LC_ALL: "C", HOME: "/h", NEBIUS_API_KEY: "secret", TEMP: "t" };
    assert.deepEqual(filterChildEnv(env, "win32"), { Path: "p", SystemRoot: "C:\\Windows", LC_ALL: "C", HOME: "/h", TEMP: "t" });
    assert.deepEqual(filterChildEnv(env, "linux"), { Path: "p", LC_ALL: "C", HOME: "/h" });
  });

  it("treats a legacy installed.json without a variant as not installed, except for the darwin-arm64 Metal build", async () => {
    const { runtime } = make();
    await runtime.install();
    writeFileSync(runtime.paths.installed, JSON.stringify({ tag: "b1", platform: "test-x64" }));
    assert.equal(runtime.isInstalled(), false);
    assert.equal(runtime.status().state, "not-installed");

    const metalBuild: LlamaBuild = { tag: "b1", assets: { "darwin-arm64": [{ ...build.assets["test-x64"][0], variant: "metal" }] } };
    const mac = make({}, { build: metalBuild, platformKey: "darwin-arm64" }).runtime;
    const before = requests;
    await mac.install();
    writeFileSync(mac.paths.installed, JSON.stringify({ tag: "b1", platform: "darwin-arm64" }));
    assert.equal(mac.isInstalled(), true);
    await mac.install();
    assert.equal(mac.status().state, "installed");
    assert.equal(requests, before + 1, "the legacy install is kept, not downloaded again");
    writeFileSync(mac.paths.installed, JSON.stringify({ tag: "b1", platform: "darwin-arm64", variant: "cpu" }));
    assert.equal(mac.isInstalled(), false, "a real variant mismatch still reinstalls");
  });

  it("treats an install of another variant as not installed", async () => {
    const { runtime } = make();
    await runtime.install();
    assert.equal(runtime.isInstalled(), true);
    writeFileSync(runtime.paths.installed, JSON.stringify({ tag: "b1", platform: "test-x64", variant: "vulkan" }));
    assert.equal(runtime.isInstalled(), false);
    assert.equal(runtime.status().state, "not-installed");
  });

  it("passes the child an allow-listed environment", async () => {
    const { runtime, home } = make({ PATH: process.env.PATH, HOME: "/h", LC_ALL: "C", NEBIUS_API_KEY: "secret", HF_TOKEN: "hf_x", PISTA_HOME: "/elsewhere" });
    await runtime.ensureRunning();
    const { env } = JSON.parse(readFileSync(join(home, "spawn.json"), "utf8")) as { env: Record<string, string> };
    assert.equal(env.NEBIUS_API_KEY, undefined);
    assert.equal(env.PISTA_HOME, undefined);
    assert.equal(env.HF_TOKEN, "hf_x");
    assert.equal(env.LC_ALL, "C");
    assert.equal(env.LLAMA_CACHE, runtime.paths.cache);
    assert.equal(env.HF_HOME, join(runtime.paths.cache, "hf"));
    assert.equal(env.XDG_CACHE_HOME, runtime.paths.cache);
    runtime.disable();
    const without = make({ PATH: process.env.PATH });
    await without.runtime.ensureRunning();
    const child = JSON.parse(readFileSync(join(without.home, "spawn.json"), "utf8")) as { env: Record<string, string> };
    assert.equal(child.env.HF_TOKEN, undefined);
  });

  it("stops after the idle timeout and restarts on demand", async () => {
    const { runtime } = make({ PISTA_LLAMA_IDLE_MS: "150" });
    await runtime.ensureRunning();
    assert.equal(runtime.status().state, "running");
    for (let i = 0; i < 60 && runtime.status().state === "running"; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(runtime.status().state, "installed");
    assert.equal(runtime.baseUrl, undefined);
    const url = await runtime.ensureRunning();
    assert.equal((await fetch(`${url}/health`)).status, 200);
  });

  it("disabling during an install cancels it, and enabling again starts a fresh one", async () => {
    const { runtime, home, events } = make();
    let release!: () => void;
    hold = new Promise<void>((resolve) => (release = resolve));
    const before = requests;
    const first = runtime.ensureRunning();
    first.catch(() => {});
    while (requests === before) await new Promise((r) => setTimeout(r, 10));
    runtime.disable();
    assert.equal(runtime.status().state, "not-installed");
    hold = undefined;
    const second = runtime.ensureRunning(); // must not inherit the cancelled install's AbortError
    release();
    await assert.rejects(first);
    await second;
    assert.equal(runtime.status().state, "running");
    assert.equal(requests, before + 2);
    assert.ok(runtime.isInstalled() && existsSync(join(home, "spawn.json")));
    assert.ok(!events.some((e) => e.state === "error"));
  });

  it("remove() waits for an in-flight install before deleting", async () => {
    const { runtime, home } = make();
    let release!: () => void;
    hold = new Promise<void>((resolve) => (release = resolve));
    const before = requests;
    const pending = runtime.ensureRunning();
    pending.catch(() => {});
    while (requests === before) await new Promise((r) => setTimeout(r, 10));
    hold = undefined;
    const removed = runtime.remove();
    release();
    await removed;
    await assert.rejects(pending);
    assert.ok(!existsSync(join(home, "bin")) && !existsSync(runtime.paths.installed) && !existsSync(join(home, "spawn.json")));
    assert.equal(runtime.status().state, "not-installed");
  });

  it("discards a download whose hash does not match", async () => {
    const { runtime, events } = make({}, { build: { tag: "b1", assets: { "test-x64": [{ ...build.assets["test-x64"][0], sha256: "0".repeat(64) }] } } });
    await assert.rejects(runtime.install(), /integrity/);
    const status = runtime.status();
    assert.equal(status.state, "error");
    assert.match(status.message ?? "", /integrity/);
    assert.ok(!existsSync(runtime.paths.bin) && !existsSync(runtime.paths.installed));
    assert.equal(events.at(-1)?.state, "error");
  });

  it("external mode uses LLAMA_BASE_URL and never installs or spawns", async () => {
    const { runtime, home } = make({ PISTA_LLAMA_RUNTIME: "external", LLAMA_BASE_URL: "http://10.0.0.5:9000/" });
    const before = requests;
    assert.equal(runtime.status().state, "running");
    assert.equal(runtime.status().baseUrl, "http://10.0.0.5:9000");
    await runtime.ensureRunning();
    assert.equal(requests, before);
    assert.ok(!existsSync(home));
    assert.equal(make({ PISTA_LLAMA_RUNTIME: "external" }).runtime.baseUrl, "http://127.0.0.1:8080");
  });

  it("off mode refuses to enable", async () => {
    const { runtime, home } = make({ PISTA_LLAMA_RUNTIME: "off" });
    assert.equal(runtime.status().mode, "off");
    assert.equal(runtime.status().state, "not-installed");
    await assert.rejects(runtime.ensureRunning(), /disabled by PISTA_LLAMA_RUNTIME=off/);
    assert.ok(!existsSync(home));
  });

  it("parses the runtime mode", () => {
    assert.equal(llamaMode({}), "managed");
    assert.equal(llamaMode({ PISTA_LLAMA_RUNTIME: "External" }), "external");
    assert.equal(llamaMode({ PISTA_LLAMA_RUNTIME: "bogus" }), "managed");
  });
});
