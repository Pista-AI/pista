// Builds UI + host + Electron main, stages the host with real node_modules, then runs
// electron-builder. `--dmg` also produces a disk image; default is an unpacked .app.
import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fetchLlama } from "./fetch-llama.mjs";

const desktop = path.resolve(import.meta.dirname, "..");
const root = path.resolve(desktop, "../..");
const build = path.join(desktop, "build");
const run = (cmd, cwd = root) => {
  console.log(`\n› ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
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

const targets = process.argv.includes("--dmg") ? "--mac dir dmg" : "--dir";
run(`pnpm exec electron-builder ${targets} --config electron-builder.config.cjs`, desktop);
console.log(`\nDone → ${path.join(desktop, "release")}`);
