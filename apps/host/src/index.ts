// The CLI runs first and exits for `policy check`, so that command touches no state (no PISTA_HOME writes, no stdout noise).
import "./cli.ts";
// Sets PI_CODING_AGENT_DIR before any Pi code runs; keep it right after the CLI.
import "./pi-env.ts";
import { loadedPolicy } from "./policy-boot.ts";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";
import { WebSocketServer } from "ws";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  type ClientFrame,
  DEFAULT_HOST_PORT,
  type HostFrame,
  type MethodName,
  type Methods,
} from "@pista/protocol";
import { cancelLogin, currentSubject, forgetSubject, listModels, listProviders, login } from "./auth.ts";
import { CLIENT_DIR, ConfigStore, piAgentDir } from "./config.ts";
import { extensionsSummary } from "./policy.ts";
import { describeMcp } from "./policy-mcp.ts";
import { accessSummary, assertProviderAllowed, unknownAllowedProviders } from "./policy-access.ts";
import { createAudit } from "./audit.ts";
import { Hub } from "./hub.ts";
import { ThreadManager } from "./threads.ts";
import { startRetention } from "./retention.ts";
import { detectLocalServers, ensureServerRunning, localPreparer, prepareWith, registerLocalServer } from "./local.ts";
import { registerNebiusProvider } from "./nebius.ts";
import { registerPolicyGateways } from "./policy-providers.ts";
import { readMemory } from "./memory.ts";
import { createLlama } from "./llama.ts";
import { blockedReason, evaluateVersionGate, gateMessage, resolveAppVersion, updatesSummary } from "./version-gate.ts";
import { activeBrowserDriverConfig, describeBrowserDriver } from "./browser-driver.ts";

const VERSION = resolveAppVersion(process.env, (message) => console.warn(`[pista-host] ${message}`));
const PORT = Number(process.env.PISTA_HOST_PORT ?? DEFAULT_HOST_PORT);
const here = dirname(fileURLToPath(import.meta.url));
const UI_DIR = process.env.PISTA_UI_DIR ?? resolve(here, "../../ui/dist");

/**
 * Browsers always send Origin on WebSocket upgrades, so this blocks arbitrary web
 * pages from driving a local agent. Non-browser local clients send none.
 */
const UI_DEV_PORT = Number(process.env.PISTA_UI_PORT ?? 5317);
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  `http://localhost:${UI_DEV_PORT}`,
  `http://127.0.0.1:${UI_DEV_PORT}`,
  "tauri://localhost",
  "http://tauri.localhost",
  "file://",
  ...(process.env.PISTA_ALLOWED_ORIGINS?.split(",").map((s) => s.trim()) ?? []),
]);

function piVersion(): string {
  try {
    const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    return JSON.parse(readFileSync(resolve(dirname(entry), "../package.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
}

// Fail at startup, not on the first browser action, when the driver is misconfigured.
try {
  console.log(`[pista-host] ${describeBrowserDriver(activeBrowserDriverConfig())}`);
} catch (error) {
  console.error(`[pista-host] ${(error as Error).message}`);
  process.exit(1);
}

const store = new ConfigStore(loadedPolicy);
console.log(
  store.policySource
    ? `[pista-host] managed policy: ${store.policySource}, ${store.policy.locked.length} locked, ${Object.keys(loadedPolicy.policy?.defaults ?? {}).length} defaults, ${loadedPolicy.policy?.providers?.gateways?.length ?? 0} gateways${accessSummary(loadedPolicy.policy)}${extensionsSummary(loadedPolicy.policy)}${store.toolRules ? ", tool rules on" : ""}`
    : "[pista-host] managed policy: none",
);
const mcpLine = describeMcp(loadedPolicy.policy?.mcp);
if (mcpLine) console.log(mcpLine);
for (const warning of store.policyWarnings) console.warn(`[pista-host] managed policy: ${warning}`);
const hub = new Hub();
const models = await ModelRuntime.create({ allowModelNetwork: true });
registerNebiusProvider(models);
const gatewayResult = registerPolicyGateways(
  loadedPolicy.policy,
  process.env,
  (id, config) => models.registerProvider(id, config),
  models.getProviders().map((provider) => provider.id),
);
for (const warning of [...gatewayResult.warnings, ...unknownAllowedProviders(loadedPolicy.policy, models.getProviders().map((provider) => provider.id))]) console.warn(`[pista-host] managed policy: ${warning}`);
const llama = createLlama({ hub, store, models, reloadIdle: () => threads.reloadIdle() });
// policy-boot.ts (imported first) has already installed the proxy/CA dispatcher the exporter's fetch relies on.
const versionGate = evaluateVersionGate(VERSION, loadedPolicy.policy?.updates);
const updates = updatesSummary(loadedPolicy.policy?.updates, process.env);
if (versionGate.status !== "ok") console.error(`[pista-host] ${gateMessage(versionGate)} The host stays up in blocked mode: agent work is refused.`);
const audit = createAudit(loadedPolicy.policy, { version: VERSION, subject: currentSubject });
if (loadedPolicy.policy?.audit) console.log(`[pista-host] audit export: OTLP/HTTP to ${new URL(loadedPolicy.policy.audit.otlpEndpoint).origin}`);
const threads = new ThreadManager(store, hub, models, prepareWith([localPreparer(store, hub), llama.prepare]), undefined, audit);
startRetention(loadedPolicy.policy?.retention, { purgeThreads: (cutoff, stats) => threads.purgeThreads(cutoff, join(piAgentDir(), "sessions"), stats) }, CLIENT_DIR, audit);

llama.start();

// Local servers may be offline at startup; their model lists refresh when models are listed.
await Promise.all(store.config.localServers.map((server) => registerLocalServer(models, server).catch(() => {})));

type Handler<M extends MethodName> = (params: Methods[M]["params"]) => Promise<Methods[M]["result"]> | Methods[M]["result"];
const handlers: { [M in MethodName]: Handler<M> } = {
  "host.hello": () => ({
    version: VERSION,
    piVersion: piVersion(),
    platform: platform(),
    homeDir: homedir(),
    config: store.config,
    policy: store.policy,
    policySource: store.policySource,
    versionGate,
    updates,
    configSources: store.sources(),
    projects: store.projects,
  }),
  "config.set": async ({ patch }) => {
    store.assertUnlocked(patch);
    const config = store.patchConfig(patch, { userSet: true });
    hub.emit({ type: "config.changed", config, configSources: store.sources() });
    if (patch.mcpServers || patch.homeUrl !== undefined || patch.instructions !== undefined || patch.memoryEnabled !== undefined || patch.webSearchEnabled !== undefined || patch.maxOutputTokens !== undefined) await threads.reloadIdle();
    return config;
  },

  "projects.add": ({ path, name }) => {
    const project = store.addProject(path, name);
    hub.emit({ type: "projects.changed", projects: store.projects });
    return project;
  },
  "projects.setTrusted": async ({ projectId, trusted }) => {
    const project = store.setProjectTrusted(projectId, trusted);
    threads.auditTrust(projectId, trusted, "set by user", "user", true);
    hub.emit({ type: "projects.changed", projects: store.projects });
    // Busy threads keep their current trust until they are next rebuilt.
    await threads.reloadIdle(projectId);
    return project;
  },
  "projects.remove": async ({ projectId }) => {
    await threads.removeProject(projectId);
  },

  "threads.list": () => threads.list(),
  "thread.create": ({ projectId }) => threads.create(projectId),
  "thread.open": ({ threadId }) => threads.open(threadId),
  "thread.prompt": ({ threadId, text, images, delivery }) => threads.prompt(threadId, text, images, delivery),
  "thread.abort": ({ threadId }) => threads.abort(threadId),
  "thread.rename": ({ threadId, title }) => threads.rename(threadId, title),
  "thread.archive": ({ threadId }) => threads.archive(threadId),
  "thread.setModel": ({ threadId, model }) => threads.setModel(threadId, model),
  "thread.setThinking": ({ threadId, mode }) => threads.setThinking(threadId, mode),
  "thread.compact": ({ threadId }) => threads.compact(threadId),
  "thread.goal.set": ({ threadId, text, maxTurns, maxTokens, check, replanEvery }) => threads.goalSet(threadId, text, { maxTurns, maxTokens, check, replanEvery }),
  "thread.goal.pause": ({ threadId }) => threads.goalPause(threadId),
  "thread.goal.resume": ({ threadId }) => threads.goalResume(threadId),
  "thread.goal.clear": ({ threadId }) => threads.goalClear(threadId),
  "thread.bash": ({ threadId, command }) => threads.bash(threadId, command),

  "models.list": async () => {
    // Pick up models downloaded or loaded in local servers since the last listing, starting
    // LM Studio's server first if it was stopped.
    await Promise.all(
      store.config.localServers.map(async (server) => {
        await ensureServerRunning(server).catch(() => false);
        await registerLocalServer(models, server).catch(() => {});
      }),
    );
    return listModels(models, store.managedPolicy);
  },
  "memory.get": () => readMemory(store.config.memoryEnabled),
  "local.detect": () => detectLocalServers(store.config.localServers, () => llama.runtime.baseUrl),
  "local.add": async ({ kind, name, baseUrl }) => {
    const id = kind === "openai" ? `local-${new URL(baseUrl).port || "server"}` : kind;
    const server = { id, kind, name, baseUrl: baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "") };
    store.assertUnlocked({ localServers: [] });
    assertProviderAllowed(store.managedPolicy, id);
    const config = store.patchConfig({ localServers: [...store.config.localServers.filter((s) => s.id !== id), server] }, { userSet: true });
    await registerLocalServer(models, server);
    hub.emit({ type: "config.changed", config, configSources: store.sources() });
  },
  "local.remove": ({ id }) => {
    store.assertUnlocked({ localServers: [] });
    models.unregisterProvider(id);
    const config = store.patchConfig({ localServers: store.config.localServers.filter((s) => s.id !== id) }, { userSet: true });
    hub.emit({ type: "config.changed", config, configSources: store.sources() });
  },
  ...llama.handlers,
  "auth.providers": () => listProviders(models, store.managedPolicy),
  "auth.login": ({ provider, type, apiKey }) => login(models, hub, provider, type, store.deviceId, apiKey, store.managedPolicy),
  "auth.logout": async ({ provider }) => {
    forgetSubject(provider);
    await models.logout(provider);
  },
  "auth.cancel": ({ provider }) => cancelLogin(provider),
  "auth.promptResponse": ({ promptId, value }) => hub.settle(promptId, value),

  "mcp.status": ({ threadId }) => threads.mcpTools(threadId),

  "browser.probe": ({ url }) => probeEmbeddable(url),

  "approval.respond": ({ approvalId, allow, always, note }) => {
    hub.settle(approvalId, { allow, always, note });
    hub.emit({ type: "approval.resolved", approvalId });
  },
  "browser.respond": ({ requestId, ok, result, error }) =>
    hub.settle(requestId, ok ? (result ?? {}) : new Error(error ?? "Browser action failed")),
};

/**
 * The iframe cannot report why a page failed to render, so the host reads the
 * framing headers instead: X-Frame-Options and CSP frame-ancestors.
 */
async function probeEmbeddable(url: string): Promise<{ embeddable: boolean; reason?: string }> {
  if (!/^https?:\/\//i.test(url)) return { embeddable: true };
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(5000) });
    void res.body?.cancel();
    const xfo = res.headers.get("x-frame-options")?.toLowerCase();
    if (xfo && /deny|sameorigin/.test(xfo)) return { embeddable: false, reason: `X-Frame-Options: ${xfo}` };
    const ancestors = res.headers
      .get("content-security-policy")
      ?.split(";")
      .map((d) => d.trim())
      .find((d) => d.toLowerCase().startsWith("frame-ancestors"));
    if (ancestors) {
      const sources = ancestors.split(/\s+/).slice(1);
      const allowsLocal = sources.some((src) => src === "*" || /localhost|127\.0\.0\.1/.test(src));
      if (!allowsLocal) return { embeddable: false, reason: ancestors };
    }
    return { embeddable: true };
  } catch {
    // Unreachable pages show the iframe's own error; nothing to add.
    return { embeddable: true };
  }
}

// -- HTTP: serves the built UI so the host alone is a runnable app ------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, version: VERSION, versionGate, updates }));
    return;
  }
  if (!existsSync(UI_DIR)) {
    res.writeHead(404).end("UI not built. Run `pnpm dev` and open http://localhost:5317, or `pnpm build`.");
    return;
  }
  let file = normalize(join(UI_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(UI_DIR) || !existsSync(file) || statSync(file).isDirectory()) file = join(UI_DIR, "index.html");
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
server.on("upgrade", (req, socket, head) => {
  const origin = req.headers.origin;
  if (new URL(req.url ?? "/", "http://localhost").pathname !== "/ws" || (origin && !ALLOWED_ORIGINS.has(origin))) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", (ws) => {
  hub.add(ws);
  ws.on("message", async (data) => {
    let frame: ClientFrame;
    try {
      frame = JSON.parse(String(data));
    } catch {
      return;
    }
    const reply = (out: HostFrame) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(out));
    hub.touch(ws);
    if (frame.method === "host.hello") hub.describe(ws, (frame.params as Methods["host.hello"]["params"]).client);
    const handler = handlers[frame.method] as Handler<MethodName> | undefined;
    if (!handler) return reply({ kind: "res", id: frame.id, ok: false, error: `Unknown method ${frame.method}` });
    const blocked = blockedReason(versionGate, frame.method); // blocked mode: the one place agent work is refused
    if (blocked) return reply({ kind: "res", id: frame.id, ok: false, error: blocked });
    try {
      const result = await handler(frame.params as never);
      reply({ kind: "res", id: frame.id, ok: true, result: result ?? null });
    } catch (error) {
      reply({ kind: "res", id: frame.id, ok: false, error: (error as Error).message ?? String(error) });
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[pista-host] pi ${piVersion()} · listening on http://127.0.0.1:${PORT} (ws: /ws)`);
});

const shutdown = () => {
  threads.dispose();
  llama.stop();
  server.close();
  // Give the final audit flush a moment; the exporter has its own timeout.
  void audit.dispose().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 6000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// When a desktop shell spawned us, exit if it goes away (crash or force quit).
if (process.env.PISTA_PARENT_PID) {
  const parent = Number(process.env.PISTA_PARENT_PID);
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      shutdown();
    }
  }, 2000).unref();
}
