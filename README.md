# Pista

Pista is an open-source desktop agent app for people who want an AI agent that works on their own machine and with their own tools. It is local-first: threads, settings and credentials live on your computer, and you choose the model, whether that is a local one (a built-in llama.cpp runtime, or LM Studio and Ollama servers) or a cloud provider. It is service-agnostic: it reaches any backend through public channels only, namely MCP servers and a real built-in browser that the agent drives next to the chat. It is built on the [Pi](https://pi.dev) agent harness, with a UI inspired by agent apps such as OpenAI's Codex.

**Status:** early (0.1). macOS is the primary platform. Windows and Linux builds exist but are untested on real hardware.



https://github.com/user-attachments/assets/511d843e-17e9-48e7-b136-4566c5b781fc





<!-- screenshot: docs/screenshot.png -->

## What is Pi?

[Pi](https://pi.dev) ([source](https://github.com/earendil-works/pi)) is an open-source, extensible agent harness. Pista embeds its SDK (`@earendil-works/pi-coding-agent`) for sessions, model providers, tools and MCP support, and adds the desktop UI, the browser tools, approvals, the local runtime and the managed-policy layer on top. Pi sessions are plain JSONL files, so Pi CLI sessions in the same folders show up in Pista too.

## Quickstart

Requires Node 22+ and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev
```

Open http://localhost:5317, then add a model under Settings (see [Model providers](#model-providers)).

- Desktop app (Electron window with a native browser panel): `pnpm dev:desktop`
- Headless, one process serving the built UI on http://127.0.0.1:4317: `pnpm build && pnpm start`

```
┌──────────────────────── UI (React, apps/ui) ────────────────────────┐
│ Sidebar: projects → threads │ Transcript + composer │ Browser/Term │
└──────────────── WebSocket JSON protocol (packages/protocol) ────────┘
┌──────────────── Agent host sidecar (Node, apps/host) ───────────────┐
│ Pi SDK sessions (one per thread) + extensions:                      │
│   Pi MCP ext  → servers from $PISTA_HOME/pi/mcp.json (Settings)     │
│   browser     → browser_* tools, executed by the UI's browser pane  │
│   approvals   → permission modes (tool_call gate)       │
│   + Pi built-ins: read/edit/write/bash, MCP, codemode, tool_search  │
└─────────────────────────────────────────────────────────────────────┘
```

## Run it

Requires Node 22+ and pnpm.

```bash
pnpm install
```

```bash
pnpm dev
```

Open http://localhost:5317. The host listens on `127.0.0.1:4317`, and Vite proxies `/ws` to it.

For a single process that serves the built UI:

```bash
pnpm build && pnpm start
```

Then open http://127.0.0.1:4317.

### Running without a desktop

`pnpm build && pnpm start` serves the app on `PISTA_HOST_PORT` (default 4317, bound to 127.0.0.1) and keeps its state in `PISTA_HOME` (default `~/.pista`).

**Credentials.** Pi reads provider API keys from the environment, so no `/login` is needed on a server: set for example `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` before starting the host. The full list is in Pi's `providers.md` ("Use an API key from the environment", in `@earendil-works/pi-coding-agent/docs`). Without environment keys, credentials live in `~/.pi/agent/auth.json`; set `PI_CODING_AGENT_DIR` to relocate that directory. Nebius Token Factory is built in: set `NEBIUS_API_KEY` to enable its models (OpenAI-compatible, `https://api.tokenfactory.nebius.com/v1`).

**Browser.** `PISTA_BROWSER_DRIVER` picks what the `browser_*` tools drive. `pane` (default) is the UI's browser pane, which is the iframe fallback when there is no desktop app, so many sites will refuse to load. `cdp` drives a Chromium started with `--remote-debugging-port`, at `PI_BROWSER_CDP_URL`; the host exits at startup if that URL is missing. `cdp` shares one tab across all threads, so it is single-thread only for now. A headless driver does not exist yet.

### Desktop app (Electron)

Develop inside the real desktop window (hot reload, native browser panel). If `pnpm dev` is already running, start only the window:

```bash
pnpm --filter @pista/desktop dev
```

Or start host, UI and window together:

```bash
pnpm dev:desktop
```

Build a runnable `Pista.app` into `apps/desktop/release/mac-arm64/`. It is ad-hoc signed for local use by default; Developer ID signing and notarization are opt-in through environment variables (`CSC_LINK`/`CSC_NAME`, `APPLE_*`), see [docs/release-signing.md](docs/release-signing.md):

```bash
pnpm package:desktop
```

The packaged app starts its own agent host on a free port (from 4417) with Electron's Node runtime, using your login shell's `PATH`. Host logs go to `~/.pista/host.log`. On macOS arm64 the build also ships the pinned llama.cpp `llama-server` in `Contents/Resources/llama` (about 31 MB; fetched once into `apps/desktop/.cache`, skip with `PISTA_BUNDLE_LLAMA=0`), see [docs/desktop-llama-bundling.md](docs/desktop-llama-bundling.md). The browser panel is a Chromium `WebContentsView`, so pages render even when they refuse iframes, and the agent can read, script and screenshot them. Add `--dmg` (`pnpm --filter @pista/desktop package:dmg`) for a disk image. Tagged releases (`v*`) are built, signed and notarized by CI, see [docs/release-signing.md](docs/release-signing.md#ci-release).

## Model providers

Providers are configured in the app under Settings, or from the environment on a server.

- **Subscriptions and API keys**: sign in with OAuth or paste a key in Settings. Pi supplies the provider list (for example Claude and ChatGPT subscriptions, and API-key providers). Credentials are stored in `$PISTA_HOME/pi/auth.json`.
- **Environment variables**: Pi reads provider keys from the environment, so a server needs no login: set for example `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` before starting the host. The full list is in Pi's `providers.md`, shipped in `@earendil-works/pi-coding-agent/docs`.
- **Nebius Token Factory** is built in: set `NEBIUS_API_KEY`.
- **Local models**: the built-in llama.cpp runtime (opt-in, see below), or an LM Studio or Ollama server that Pista detects on its default local port.
- **Organisations** can add OpenAI-compatible gateways and restrict providers and models with a managed policy, see [docs/ENTERPRISE.md](docs/ENTERPRISE.md).

### First-time setup (in the app → Settings)

1. **Model providers**: see above. Pi's state (sessions, sign-ins, MCP) is kept under `$PISTA_HOME/pi` (override with `PI_CODING_AGENT_DIR`); on first start it is copied once from `~/.pi/agent`, which is left untouched. Agent memory (`MEMORY.md`, daily logs) lives in `$PISTA_HOME/pi/memory` (override with `PI_MEMORY_DIR`) and is likewise copied once from `~/.pi/agent/memory`.
2. **MCP servers** (optional): add a streamable-HTTP or stdio MCP server. They are stored in `$PISTA_HOME/pi/mcp.json` in the standard `mcpServers` format, so entries copy across to and from Claude Code and Cursor. The file is the same `mcpServers` map those tools read, and `${VAR}` references are expanded from the environment when Pi connects. Reference tokens as `${ENV_VAR}` rather than writing them in the file; OAuth login from the UI is coming.
3. **Projects**: add folders with the folder icon in the sidebar. A thread's tools run inside its project folder. A scratch workspace exists by default.

Environment variables: `PISTA_HOST_PORT`, `PISTA_UI_PORT`, `PISTA_HOME` (default `~/.pista`), `PISTA_HOME_URL` (browser home page at first start), `PISTA_ALLOWED_ORIGINS`, `PISTA_BROWSER_DRIVER` (`pane` or `cdp`), `PI_BROWSER_CDP_URL` (with `cdp`), and Pi's own `PI_CODING_AGENT_DIR` and `PI_MEMORY_DIR`.

**Built-in local runtime (llama.cpp).** Opt-in: when enabled, the host downloads a pinned, hash-verified `llama-server` into `$PISTA_HOME/llama` and runs it on 127.0.0.1 in router mode, stopping it after 30 idle minutes. Models and the Hugging Face cache stay under `$PISTA_HOME/llama` too. The default `models.ini` asks for a 32k context (`c = 32768`) because Pista's system prompt and tool schemas take about 13k tokens and the Pi SDK keeps 4k in reserve, so 16k leaves no room for replies. `PISTA_LLAMA_RUNTIME` is `managed` (default), `external` (use your own server at `LLAMA_BASE_URL`, default `http://127.0.0.1:8080`; that URL is your own configuration and is not restricted to loopback) or `off`. `PISTA_LLAMA_IDLE_MS` overrides the idle stop. Supported platforms: macOS arm64 (Metal), Windows x64 (Vulkan, CPU fallback), Windows arm64 (CPU), Linux x64 (Vulkan, CPU fallback) and Linux arm64 (CPU). Vulkan is chosen when a Vulkan loader library is present; `PISTA_LLAMA_VARIANT=cpu|vulkan` overrides that, and `PISTA_LLAMA_VARIANT=cpu` forces the CPU build if the GPU path fails (an unrecognised value is ignored and the default selection applies). The Windows and Linux builds are pinned and hash-verified but untested on real hardware so far.

## What's in the UI

- **Threads per project** in the sidebar, persisted as Pi sessions (JSONL). Pi CLI sessions in the same folders show up too.
- **Transcript**: user bubbles, streamed markdown answers, and the work log collapsed into "Worked for 42s · 6 steps". Expand it to see each step's input, output and diffs. While the agent runs, the latest commentary and step stay visible.
- **Composer**: model picker, reasoning effort, image paste/attach, and "Attach page" (tells the agent which page is open). ↩ steers a running agent, ⌥↩ queues a follow-up, Esc stops.
- **Permissions**: *Read only*, *Default* (asks before edits, shell commands, browser interaction and MCP tools that change data) and *Full access*. Approvals appear inline; declining can include a note telling the agent what to do instead.
- **Side panel**: built-in **Browser** (the agent drives it through `browser_*` tools and a badge shows what it is doing), **Terminal** (commands run in the thread's folder and their output is shared with the agent) and **Tools** (everything the session can call, grouped by MCP server).
- Shortcuts: ⌘N new thread, ⌘B sidebar, ⌘J panel, ⌘, settings.

## Browser automation

The agent drives the built-in browser step by step (`browser_snapshot`, `browser_click`, …) with ref-based page snapshots, so a small local model can browse without a separate planner. Details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Layout

```
apps/host            Node sidecar: Pi SDK, WebSocket server, MCP/browser/approval extensions
apps/ui              React + Vite UI (shell-agnostic)
apps/desktop         Electron shell with a native browser view
packages/protocol    Shared wire types (UI ⇄ host)
packages/pi-browser  The `browser_*` tools (also usable as a plain pi package)
docs/                Architecture and packaging notes
```

Deploying to a team? A managed policy can preset and lock settings, restrict providers, MCP servers and browser domains, add OIDC sign-in, export an audit trail over OTLP and gate app versions. Validate a rollout with `pnpm policy:check`. See [docs/ENTERPRISE.md](docs/ENTERPRISE.md).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the protocol, the browser bridge and the Electron/Tauri packaging plan, and [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for MCP and other integrations.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) to get started and [SECURITY.md](SECURITY.md) to report a vulnerability. Release notes are in [CHANGELOG.md](CHANGELOG.md).

## License

Apache-2.0, see [LICENSE](LICENSE).
