// Builds UI + host + Electron main, stages the host with real node_modules, then runs
// electron-builder. `--dmg` also produces a disk image; default is an unpacked .app.
import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fetchLlama } from "./fetch-llama.mjs";
import { writeChannelYmls } from "./channel-ymls.mjs";

const desktop = path.resolve(import.meta.dirname, "..");
const root = path.resolve(desktop, "../..");
const build = path.join(desktop, "build");
const run = (cmd, cwd = root, env = process.env) => {
  console.log(`\n› ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", env });
};

run("pnpm --filter @pista/ui build");
run("pnpm --filter @pista/host build");
run("pnpm --filter @pista/desktop build:main");

rmSync(build, { recursive: true, force: true });
rmSync(path.join(desktop, "release"), { recursive: true, force: true });
// A flat (hoisted) production install of the host so Pi and its deps resolve without pnpm symlinks.
execSync(`pnpm --filter @pista/host deploy --prod "${path.join(build, "host")}"`, {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, npm_config_node_linker: "hoisted" },
});
cpSync(path.join(root, "apps/host/dist"), path.join(build, "host/dist"), { recursive: true });
cpSync(path.join(root, "apps/ui/dist"), path.join(build, "ui"), { recursive: true });
if (!existsSync(path.join(build, "host/node_modules/@earendil-works/pi-coding-agent"))) {
  throw new Error("Host deploy is missing @earendil-works/pi-coding-agent");
}

// macOS arm64 builds ship the pinned llama-server in Resources/llama; other platforms skip this and the host downloads it.
await fetchLlama({ outRoot: path.join(build, "llama") });

// --dmg also builds the zip (Squirrel.Mac updates from the zip) plus latest-mac.yml and blockmaps; --win builds the NSIS
// installer (plus latest.yml), --linux AppImage + deb (each only on its own OS family). Never publishes.
// Targets come from electron-builder.config.cjs, so only the platform flag is passed.
const targets = process.argv.includes("--dmg") ? "--mac dir dmg zip" : process.argv.includes("--win") ? "--win" : process.argv.includes("--linux") ? "--linux" : "--dir";
// A secret that is absent reaches CI as "" (defined but empty). electron-builder treats an empty CSC_LINK as a path
// (the cwd) and fails with "not a file", so empty signing variables are dropped. Without a certificate, identity
// auto-discovery is turned off too, so an unsigned build never picks up a stray keychain identity.
const SIGNING_VARS = ["CSC_LINK", "CSC_KEY_PASSWORD", "CSC_NAME", "WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"];
const builderEnv = { ...process.env };
for (const name of SIGNING_VARS) if (builderEnv[name] !== undefined && builderEnv[name].trim() === "") delete builderEnv[name];
if (!builderEnv.CSC_LINK && !builderEnv.CSC_NAME) builderEnv.CSC_IDENTITY_AUTO_DISCOVERY = "false";
// PISTA_BUILD_VERSION (set by the release workflows from the tag) overrides the version in package.json, so artifact
// names, app.getVersion(), app-update.yml and the channel yml carry it. electron-builder derives the update channel
// from the first prerelease identifier only for non-GitHub providers; with GitHub it writes latest*.yml for every
// version, so writeChannelYmls adds the <channel>*.yml copies below.
const buildVersion = (builderEnv.PISTA_BUILD_VERSION ?? "").trim();
if (buildVersion && !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/.test(buildVersion)) {
  throw new Error(`PISTA_BUILD_VERSION "${buildVersion}" is not semver (MAJOR.MINOR.PATCH with an optional -prerelease)`);
}
const versionFlag = buildVersion ? ` -c.extraMetadata.version=${buildVersion}` : "";
run(`pnpm exec electron-builder ${targets}${versionFlag} --publish never --config electron-builder.config.cjs`, desktop, builderEnv);
if (buildVersion) {
  const extra = writeChannelYmls(path.join(desktop, "release"), buildVersion);
  if (extra.length) console.log(`Channel feed files: ${extra.join(", ")}`);
}
console.log(`\nDone → ${path.join(desktop, "release")}`);
