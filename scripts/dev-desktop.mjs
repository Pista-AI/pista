// `pnpm dev:desktop`: opens the Electron window in dev mode, starting the host and the
// Vite UI only if they are not already running (e.g. from `pnpm dev` in another tab).
import { spawn } from "node:child_process";
import { createConnection } from "node:net";

const HOST_PORT = Number(process.env.PISTA_HOST_PORT ?? 4317);
const UI_PORT = Number(process.env.PISTA_UI_PORT ?? 5317);

const listening = (port, host) =>
  new Promise((resolve) => {
    const socket = createConnection({ port, host });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });

const isUp = async (port) => (await listening(port, "127.0.0.1")) || (await listening(port, "::1"));

const children = [];
const start = (name, args) => {
  console.log(`[dev:desktop] starting ${name}`);
  const child = spawn("pnpm", args, { stdio: "inherit", env: process.env });
  children.push(child);
  child.on("exit", (code) => {
    if (name === "app") shutdown(code ?? 0);
  });
};

function shutdown(code = 0) {
  for (const child of children) if (!child.killed) child.kill("SIGTERM");
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (await isUp(HOST_PORT)) console.log(`[dev:desktop] reusing agent host on :${HOST_PORT}`);
else start("host", ["--filter", "@pista/host", "dev"]);

if (await isUp(UI_PORT)) console.log(`[dev:desktop] reusing UI dev server on :${UI_PORT}`);
else start("ui", ["--filter", "@pista/ui", "dev"]);

// The Electron main process waits for the UI URL itself before opening the window.
start("app", ["--filter", "@pista/desktop", "dev"]);
