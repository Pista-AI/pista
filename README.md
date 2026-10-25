# Pista

An open-source desktop agent app built on the [Pi](https://pi.dev) agent harness, with a UI modelled on the Codex app. Bring your own model (Claude, ChatGPT and other subscriptions or API keys, or local models via LM Studio, Ollama or llama.cpp), connect any MCP server, and let the agent work in a real built-in browser next to the chat.

```
┌──────────────────────── UI (React, apps/ui) ────────────────────────┐
│ Sidebar: projects → threads │ Transcript + composer │ Browser/Term │
└──────────────── WebSocket JSON protocol (packages/protocol) ────────┘
┌──────────────── Agent host sidecar (Node, apps/host) ───────────────┐
│ Pi SDK sessions (one per thread) + extensions:                      │
│   Pi MCP ext  → servers from $PISTA_HOME/pi/mcp.json (Settings)     │
│   browser     → browser_* tools, executed by the UI's browser pane  │
│   approvals   → Codex-style permission modes (tool_call gate)       │
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

### First-time setup (in the app → Settings)

1. **Model providers**: sign in (OAuth, e.g. Claude or ChatGPT subscriptions), paste an API key, or add a local model server. Credentials live in `$PISTA_HOME/pi/auth.json`. Pi's state (sessions, sign-ins, MCP) is kept under `$PISTA_HOME/pi` (override with `PI_CODING_AGENT_DIR`); on first start it is copied once from `~/.pi/agent`, which is left untouched. Agent memory (`MEMORY.md`, daily logs) lives in `$PISTA_HOME/pi/memory` (override with `PI_MEMORY_DIR`) and is likewise copied once from `~/.pi/agent/memory`.
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

Deploying to a team? A managed policy file can preset and lock settings, see [docs/ENTERPRISE.md](docs/ENTERPRISE.md).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the protocol, the browser bridge and the Electron/Tauri packaging plan.

## License

Apache-2.0, see [LICENSE](LICENSE).
