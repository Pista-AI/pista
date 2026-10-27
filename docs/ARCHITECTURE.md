# Architecture

## Why a host sidecar

Pi is a Node library. The UI must run in a plain browser (dev), in Electron, and in Tauri 2's system webview, where Node is not available in the renderer. So the agent runs in a separate Node process (`apps/host`), and the UI talks to it over one WebSocket:

- **Electron**: the main process spawns the host (or imports it directly) and loads the UI with `window.pistaDesktop.hostUrl` injected by the preload script.
- **Tauri 2**: ship the host as a [sidecar](https://v2.tauri.app/develop/sidecar/). Build a single binary with `node --experimental-sea-config` or `bun build --compile`. The webview connects to it on localhost.
- **Web/dev**: Vite proxies `/ws`, or the host serves the built UI itself.

The host only accepts WebSocket upgrades from known origins (localhost UI ports, `tauri://localhost`, `file://`) and binds to `127.0.0.1`. A random web page therefore cannot drive the local agent.

## Protocol (`packages/protocol`)

JSON frames over WebSocket:

- UI → host: `{kind:"req", id, method, params}` (see `Methods`)
- host → UI: `{kind:"res", id, ok, result|error}` and `{kind:"evt", event}` (see `HostEvent`)

Agent activity is forwarded as `thread.event` and carries Pi's session events in their JSON/RPC wire shape: `message_update` holds deltas only, and `message_end` is authoritative. The UI rebuilds the transcript from these events (`apps/ui/src/lib/store.ts`).

Some calls go from the host to the UI and wait for an answer. They use the same channel through `Hub.ask()`:

| Event | Answer method | Purpose |
|---|---|---|
| `browser.request` | `browser.respond` | Agent's `browser_*` tool calls run in the UI's browser |
| `approval.request` | `approval.respond` | Permission gate for writes |
| `auth.prompt` | `auth.promptResponse` | Steps of a provider login flow |

The protocol mirrors Pi's own RPC concepts. Replacing the SDK host with `pi --mode rpc` behind a thin adapter is therefore possible if process isolation per thread is ever needed.

## Sessions

Each thread is one Pi `AgentSession` with a `SessionManager` stored under `$PISTA_HOME/pi/sessions/<cwd>/` (Pi's agent dir is set to `$PISTA_HOME/pi` before Pi loads; `PI_CODING_AGENT_DIR` overrides it, and the first start copies `~/.pi/agent` once). pi-memory's directory is `$PISTA_HOME/pi/memory` (`PI_MEMORY_DIR` overrides). Threads are listed with `SessionManager.list(projectPath)`. MCP servers live in `$PISTA_HOME/pi/mcp.json` (standard `mcpServers` format, copy-compatible with Claude Code and Cursor) and are connected by Pi's built-in MCP extension; `config.set` edits that file. Live sessions stay in memory. Changing the MCP servers, home page or instructions re-creates idle sessions so the change takes effect. Hand edits to mcp.json are picked up on the next read, but running sessions reconnect only after a save from Settings or a new thread. Legacy entries migrated from config.json that used a literal `token` are written as a literal `Authorization` header; the file is mode 0600, but users should replace that value with a `${VAR}` reference.

## Project trust

Pi loads a project's `.pi/` folder (settings, `mcp.json`, extensions, skills, prompts, packages, `SYSTEM.md`, `APPEND_SYSTEM.md`) and the `.agents/skills` folders of the project and its ancestors only for a trusted project, but the SDK trusts every project unless told otherwise, so a cloned repo could register its own MCP servers and extensions silently. The host decides trust itself in `apps/host/src/project-trust.ts`: a cwd is trusted only if it is the default workspace (`$PISTA_HOME/workspace`) or its project entry in config.json has `"trusted": true`. There is no prompt, and Pi's `trust.json` and `defaultProjectTrust` are not consulted. `buildSession` passes the result as `projectTrusted` to the one `SettingsManager` shared by the resource loader and the session (default: untrusted), and `ThreadManager.load` logs a line when it skips an existing `.pi/` folder. Trust is decided per cwd, so a child thread whose cwd is a subdirectory of a trusted project is untrusted unless that directory is itself registered. Untrusted projects lose only those project-level resources; the agent-dir config, Pista's own extensions and `AGENTS.md` / `CLAUDE.md` load as before. Nothing sets the flag over RPC yet, so a project is marked trusted by editing config.json.

## Custom sub-agent roles

Besides `explorer`, `implementer` and `reviewer`, the `agent` tool offers roles defined as markdown files with YAML frontmatter (a subset of the Pi / pi-subagents agent format), read from `$PISTA_HOME/agents/*.md` and, for a trusted project only (see Project trust), `<project>/.pista/agents/*.md`. Precedence by `name`: project, then user, then built-in. Files are read when a project is first used after the host starts; there is no watcher.

```markdown
---
name: scout
description: Finds where a feature lives and reports file paths.
tools: read, grep, find, ls
excludeTools: bash
model: anthropic/claude-haiku-4-5
thinking: low
systemPromptMode: append
---
Report at most ten paths, each with one line on why it matters.
```

`name` (lowercase slug) and `description` (shown to the model) are required. `tools` is an allowlist (comma list or YAML list; omitted means everything the parent has, like the implementer), `excludeTools` a denylist, `model` is `provider/model`, `thinking` a Pi level, and the body is the role prompt: `append` follows the built-in role prompt, `replace` replaces it (Pista's own system prompt always stays). Unknown keys are ignored; nothing that loosens permissions is read. A malformed file is skipped with a logged warning.

A file named like a built-in (`explorer`, `implementer`, `reviewer`) can only narrow it: the built-in tool set is the ceiling, and omitted `tools` keeps it. Custom roles are configured through `agentOverrides`, not `agentRoles` (which stays for the built-ins' models).\n\nA custom role is an ordinary child thread: the role gate, approvals, org policy gate and audit extensions attach exactly as for built-in roles, so a file can only narrow what the parent could do. `HostConfig.agentOverrides` (`{ model, thinking, tools, excludeTools, disabled }` per role name) applies on top of built-in and file roles; its `tools` intersect with the role's, and its `model` wins over `agentRoles`, which stays for now.

## Verify gate

When a sub-agent child that changed files (a successful `edit` or `write` tool call; files changed through bash are not detected) finishes its run, the host runs the project's check commands before the parent gets the report (`apps/host/src/verify.ts`, wired into the `agent` tool in `subagent.ts`). If a command fails, its last ~4000 characters of output go back to the child as a follow-up message, up to `maxAttempts` runs in total. The parent's result then ends with one status line: `Verify: passed`, `Verify: failed after N attempts (<command>)` or `Verify: skipped (<reason>)`.

Config is `<project>/.pista/verify.json`, read only while the project is trusted (checked on every use), over an optional user-level `verify` in config.json with the same shape. There is no auto-detection.

```json
{ "commands": ["pnpm typecheck", "pnpm test"], "timeoutSec": 600, "maxAttempts": 2 }
```

Every command must pass the managed policy's `tools.bash` rules before any of them runs; a denied one reports `skipped (blocked by policy)` and nothing runs. Commands run through the shell with the project as cwd and the timeout per command, in their own process group (killed whole on timeout or stop), one verify at a time per project. The config is read before the child runs; if it differs afterwards (the child rewrote `verify.json`), nothing runs and the line says `skipped (verify.json changed during run)`. The gate is skipped when no commands are configured, when the approval mode is read-only, and when the child made no file edits. Each run is logged as an `agent_result` decision; it is not emitted to the OTLP tool audit (the host, not the model, runs these commands, so they are not tool calls).


## Model tiers

`HostConfig.modelTiers` maps free-form tier names (a slug, `[a-z0-9][a-z0-9_-]*`, for example `local`, `cheap`, `standard`, `strong`) to concrete models. A role's `model` can then be `tier:<name>` instead of a model: in a role file (`model: tier:cheap`), in `agentOverrides` or in `agentRoles`. In config JSON the value is the string `"tier:cheap"` where a `{ provider, id }` object would go.

Precedence is unchanged: `agentOverrides`, then `agentRoles`, then the file's model, then the parent's model. The first source that sets a model wins, and only then is a `tier:<name>` looked up (`resolveModelTier` in `model-tiers.ts`). A tier that is not in `modelTiers` is not an error: the child uses the parent's model and the host logs a warning. It does not fall through to a lower-precedence source. The org model allowlist is checked on the resolved model exactly as for a concrete one, and a disallowed model falls back to the parent's. `modelTiers` and `tier:` values are shape-checked in managed policy `locked` and `defaults`; whether a tier exists is only checked when a child starts.

```json
{
  "modelTiers": {
    "cheap": { "provider": "anthropic", "id": "claude-haiku-4-5" },
    "strong": { "provider": "anthropic", "id": "claude-opus-4-5" }
  },
  "agentOverrides": { "scout": { "model": "tier:cheap" }, "reviewer": { "model": "tier:strong" } }
}
```

## Preset evals

`pnpm eval:presets` compares harness presets (a `HostConfig` fragment such as `agentOverrides` and `modelTiers`, plus optional role files and `verify.json`) on fixed coding tasks and reports pass rate, cost, tokens and time. The fixtures live in `evals/presets/` (`presets/<name>/preset.json`, `tasks/<name>/`; see its README); the runner is `apps/host/src/eval/` (`cli.ts` parses flags, `presets.ts` orchestrates and reports, `run-one.ts` executes one run through a real `ThreadManager`).

Isolation: every run is its own child process (the host reads `PISTA_HOME` and the Pi dirs at import time), in its own process group that is killed whole on timeout. The child gets a fresh `PISTA_HOME`, `PI_CODING_AGENT_DIR` and `PI_MEMORY_DIR` under a scratch directory; real runs copy only `auth.json` and `models-store.json` from the user's Pi agent dir. The environment is an allowlist (basics and provider credentials; no `PISTA_*`, `PI_*` or `NODE_OPTIONS` from the parent). The workspace is a copy of the task fixture; the hidden check files are staged into it only after the agent reports done, and the check command must exit 0. This is not a sandbox: the agent runs with the user's OS permissions. Real runs need `--model provider/id` and `--max-usd`, a cumulative cost cap after which the remaining runs are skipped.

`pnpm eval:presets --fake --presets solo,routed` uses a scripted model (no API calls, no credentials) and is the quick check that the runner and both presets still work.

## Source of truth for settings

Pista's `config.json` owns the model and provider defaults, the approval mode and every other setting the UI shows. Pi's `$PISTA_HOME/pi/settings.json` is derived: `buildSession` rewrites its `defaultProvider` and `defaultModel` from `config.defaultModel` on every session build (when Pista has one), and the host never reads those two values back from Pi, so hand-editing them has no effect. `models.json` and `auth.json` are Pi-owned inputs that Pista only reads through Pi. A future managed-policy loader will generate the Pi files from policy rather than have users edit them.

## Browser tools

The `browser_*` tools live in `packages/pi-browser` (`@pista/pi-browser`), a private pi package that is never published. It builds ref-based snapshots (`[e12] button "Search"`) and actions on a small `BrowserDriver` interface: navigate, state, eval, trusted input, screenshot.

- Inside the app, the host's `PaneBrowserDriver` (`apps/host/src/extensions.ts`) sends those primitives as `browser.request` events to the UI's browser.
- Standalone, the package's `pi.extensions` entry drives any Chromium over CDP (`PI_BROWSER_CDP_URL`, default `http://127.0.0.1:9222`).

Page scripts are serialized functions (`page-scripts.ts`), so they must stay self-contained.

LLM APIs are stateless: every turn resends the whole conversation. `context.ts` therefore uses pi's `context` hook to replace all page views except the latest (snapshots, reads, screenshots, action results) with a one-line stub before each request. The session file and transcript keep the full results. Measured on a recorded 32-turn session (`test/replay-context.ts`): 41% less total input and half the final context.

Safety stops live in the tools themselves (`safety.ts`, `actions.ts`), so they apply to any model and any driver:
- `browser_navigate` declines a cookie banner once per navigation (reject or necessary-only, never accept) and says so in its result.
- `browser_click` holds a click on a button, submit control or other clickable when one of its names (accessible name, visible text, image alt, svg title, or the derived name shown with `~` in snapshots) looks consequential: buy, pay, send, delete, sign in or out, accept, and the Swedish, German, French and Spanish equivalents. Whole words only; "post" and "confirm" count as a whole name or with an object (`confirm order`). A link counts when its name is 4 words or fewer and either holds a multi-word phrase anywhere ("Proceed to payment", "Gå till kassan", "Zur Kasse", "Slutför köp") or starts with a risky word ("Pay now", "Boka", "Checkout"); a single risky word later in the name is a noun in a title, so "Maternity pay and leave", "Terms of purchase", "Payment options" and longer names navigate freely. Known trade-off: a short link that merely starts with a risky word ("Send feedback", "Buy guide") also stops and costs the user one question. A page-supplied `role` that would make a real `<a>`, `<button>` or button-like `<input>` look like a field is ignored (the tag wins), and the full control name is tested, not its shortened display form. Fields and toggles never count. The tools take no `confirm` argument. A held action is lifted only by the user's approval through the host (below); otherwise the result is one fixed message beginning "Stopped: ... needs the user's approval, which was not given", telling the model to report to the user rather than retry.
- `browser_type` never types into a password field, and with `submit` it types but holds back Enter when the form's submit button looks consequential. `browser_press` refuses while a password field has focus, and holds Enter in a field whose form has a consequential submit button, and Enter or Space on a focused consequential control, exactly like a click. Key chords count by their last part (Control+Enter, Meta+Enter, Shift+Enter are Enter). It fails closed: if the focused element cannot be inspected (the peek failed, or focus is in an iframe, a shadow root or on a custom element), Enter and Space stop. Deliberately not stopped: Enter in a `<textarea>` (a newline, so also Control+Enter there) and in an `<input>` outside any form (mostly search boxes).
- Interplay with approvals: a held action is lifted only by the user's yes to a question that names the exact action. The tool asks it itself through the host (`approval.request`, e.g. `clicking button "Place order"`) at the moment it hits a stop, in every approval mode. The card's title is the exact action (control kind and name sanitized: control and bidi characters dropped, quotes escaped, kind capped at 20 and the text at 160 characters), it offers no "Always allow", it expires after 120 s, and a Stop of the run withdraws it (`approval.resolved`); a yes arriving after that does nothing. After a yes the tool looks at the control again and aborts if its kind or name changed while the user decided. An earlier generic approval of the call (ask-writes shows only `{ref:"e3"}`) does not count, so a risky action can prompt twice. Headless: if no window is connected (or the tool runs standalone, as in the eval suite) there is nobody to ask, the stop stands and the model is told to report it. There is no automatic-approve switch. `browser_eval` bypasses page stops (follow-up); it is covered only by the approvals prompt outside full-access mode, and its description says not to use it for passwords or purchases.
- Follow-ups (not covered by the stops above): `browser_eval` bypasses every page stop, and `browser_select` can fire a page's `onchange` handler (a dropdown that submits or navigates) without any check.

The host's system prompt tells the model to fetch first: `web_search` / `fetch_content` for information on a public page (when web search is on), and the browser tools only for interaction (forms, logins, dynamic pages) or when the user asked for the browser.

`browsing-turns.ts` (host): temperature 0 on planner turns inside a browsing sequence. A request to a local model in "auto" thinking mode that directly follows `browser_*` tool results is sent with `temperature: 0` through Pi's `before_provider_request` hook; thinking stays under the auto-thinking judge (measured: fully disabling thinking cost 2 of 9 suite tasks with Gemma 4 E4B, which then skipped form steps and guessed URLs). The first request of a user message, an explicit thinking mode and cloud models are never changed. The final answer after the last tool result has the same shape as a mid-sequence request, so it is affected too. One `[browsing-turns]` log line per sequence.

## Browser bridge

`apps/ui/src/browser/bridge.ts` defines `DesktopBrowserBridge`, which a desktop shell implements:

- **Electron**: a `WebContentsView` placed at the rectangle the UI reports through `setBounds()`. Use `webContents.executeJavaScript` for eval, `sendInputEvent`/`insertText` for trusted input (clicks and keys arrive with `isTrusted`), and `webContents.capturePage()` for screenshots. Expose it via `contextBridge.exposeInMainWorld("pistaDesktop", …)`.
- **Tauri 2**: a child `Webview` added to the window (`Window::add_child`), with `invoke` commands for navigate, eval and bounds. Screenshots need a platform plugin or an injected `html2canvas`.

Without a bridge (web build) the UI falls back to an `<iframe>`. Navigation works, but reading cross-origin pages, screenshots, and sites that send `X-Frame-Options`/`frame-ancestors` do not. The UI says so, and the tool results tell the agent.

## Built-in local runtime (llama.cpp)

`LlamaRuntime` (`apps/host/src/llama-runtime.ts`) installs a pinned llama.cpp release on opt-in (`llama.enable`) and supervises `llama-server` in router mode on a free loopback port, using the hash-verified download and process helpers from `@pista/local-runtime`. Layout under `$PISTA_HOME/llama`: `downloads/` (archive, removed after extraction), `bin/<tag>/`, `models/` (`--models-dir`), `cache/` (`LLAMA_CACHE`, so server-side Hugging Face downloads stay under `PISTA_HOME`), `models.ini` (router preset, written once; the default is `c = 32768` because the fixed prompt prefix is about 13k tokens and Pi keeps a 4k safety margin, and a file that still equals the old 16k default is upgraded, anything the user edited is never touched; models whose window is below 24576 get a warning `message` in the UI) and `installed.json`. When `PISTA_LLAMA_BUNDLE_DIR` points at a folder holding `<tag>/llama-server` for the pinned tag (the desktop app sets it to `Resources/llama`), that binary is used instead of a download, `llama.status` reports `source: "bundled"` (or `"downloaded"`), and `llama.remove` never touches it. `llama.remove` deletes only the binary side (`bin/`, `downloads/`, `installed.json`). Status is the `llama.status` method and event; `PISTA_LLAMA_RUNTIME=external|off` skips install and spawn. Each platform key lists its builds in preference order (Vulkan before CPU); the runtime picks the first usable one (Vulkan only if a loader is found, or as `PISTA_LLAMA_VARIANT` asks), records the variant in `installed.json` and refetches when it changes. Windows assets are zips (extracted with `tar` there, `unzip` elsewhere), and each asset names its own `llama-server` path. The Windows and Linux assets are pinned and hash-verified but not yet run on real hardware.

The runtime binary is fetched from github.com releases and models and search come from huggingface.co. Both happen only on the user's opt-in (enabling the runtime, downloading or searching for a model) and are the sanctioned outbound exceptions to the loopback-only rule. For lists, the UI uses `models.list` for the model picker, `local.detect` for external servers (a server the built-in runtime already serves is left out), and `llama.models.list` for the built-in runtime card.

### Guards for small local models

Past thinking is not replayed to local models: the host's `context` hook (`context-prune.ts`) drops `thinking` blocks from every assistant message except the last in the outgoing copy, because pi-ai would send them back as `reasoning_content` and a small model copies its earlier reasoning verbatim; the session file keeps them. The loop guard (`extensions.ts`) also ends a run after four blocked calls of any kind (`MAX_BLOCKED`) and, for local models only, after 30 tool calls in one prompt (`MAX_TOOL_CALLS_LOCAL`); `browser_scroll` is exempt.

The same hook trims what the model re-reads: `web_search` and `fetch_content` results collapse to one summary line once the model has navigated on (or two turns later), but only in threads that have used a `browser_*` tool, and older bulky tool results become stubs. Environment: `PISTA_CONTEXT_PRUNE=off` disables it, `PISTA_CONTEXT_PRUNE_KEEP` (default 4) and `PISTA_CONTEXT_PRUNE_PROTECT` (default `write,edit`) tune the stubbing, and `PISTA_PRUNE_RESULT_CHARS` (default 600) is the length up to which older results stay verbatim.

## Packaging checklist

1. `pnpm build` produces `apps/ui/dist` (relative asset paths, so it works from `file://` or `tauri://`) and `apps/host/dist/host.mjs`. Pi, `ws` and `typebox` stay external and must be shipped with it, or bundled into a single executable.
2. The shell starts the host with `PISTA_HOST_PORT` set to a free port and injects `hostUrl`.
3. The shell implements `DesktopBrowserBridge`, plus `openExternal` and `pickFolder`.
4. macOS: the window uses a hidden title bar with inset traffic lights. The UI already reserves 80px on the sidebar's top row and marks drag regions (`.drag`/`.no-drag`).
