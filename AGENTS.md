# AGENTS.md — Pista

Guidance for coding agents and human contributors working in this repository.

## Principle

Pista stays **service-agnostic**. It reaches any backend only through public channels
(MCP servers, the browser). Do not couple it to one service's internals.

## Project facts

- **What it is**: an open-source desktop agent app built on the Pi agent harness,
  UI modelled on the Codex app. Details in `README.md` and
  `docs/ARCHITECTURE.md`.
- **Monorepo**: pnpm workspaces, Node 22+, TypeScript, ESM (`"type": "module"`).
  - `apps/host` — Node sidecar: Pi SDK sessions, WebSocket server, `mcp-servers`/`browser`/
    `approvals` extensions (`src/extensions.ts`).
  - `apps/ui` — React + Vite UI, shell-agnostic. Transcript state in `src/lib/store.ts`,
    desktop bridge in `src/browser/bridge.ts`.
  - `apps/desktop` — Electron shell, `WebContentsView` browser panel, packaging.
  - `packages/protocol` — shared wire types UI ⇄ host (`req`/`res`/`evt` frames).
  - `packages/pi-browser` — `browser_*` tools, ref-based snapshots,
    safety stops. Page scripts in `page-scripts.ts` must stay
    self-contained (they are serialized).
- **Commands** (run from repo root):
  - `pnpm install`
  - `pnpm dev` — host on 127.0.0.1:4317, UI on http://localhost:5317 (Vite proxies `/ws`)
  - `pnpm dev:desktop` — host + UI + Electron window
  - `pnpm build && pnpm start` — single process serving built UI on 4317
  - `pnpm typecheck` — all packages
  - `pnpm test` — all packages
  - `pnpm package:desktop` — ad-hoc signed `Pista.app` into `apps/desktop/release/mac-arm64/` (Developer ID signing and notarization are opt-in via env, see `docs/release-signing.md`)
- **Config and secrets**: client state in `~/.pista` (`PISTA_HOME`); Pi state (sessions, `auth.json`,
  `mcp.json`) in `$PISTA_HOME/pi` (override `PI_CODING_AGENT_DIR`). MCP servers are
  `$PISTA_HOME/pi/mcp.json` in the standard `mcpServers` format, copy-compatible with
  Claude Code and Cursor; tokens are `${ENV_VAR}` references, never literals in files or source.
- **Security invariants**: host binds 127.0.0.1 and accepts WebSocket upgrades only
  from known origins; llama.cpp downloads are opt-in and hash-verified; consequential
  browser actions and password fields hand control back to the user.
- **Git**: default branch for PRs is `main`. One concern per PR; keep PRs small.

## Server-readiness rules

Pista must be deployable as a headless server, not only as a desktop app.

- **The host never assumes Electron.** Desktop-only code goes behind `DesktopBrowserBridge` /
  `window.pistaDesktop` in the UI, or behind a driver interface in the host. Why: the same host
  must run with no Electron process present.
- **All per-user state lives under `PISTA_HOME`.** Never write elsewhere in the home directory
  from host code. Why: a server deployment mounts one volume and must find everything in it.
- **Secrets come from environment variables.** Never from files in the repo, never hard-coded,
  never new files in the home directory. Why: containers and CI inject secrets through the environment.
- **The host binds loopback only** and reaches outside only through MCP servers and the browser
  driver. No new listeners, no new outbound assumptions. Why: the security model depends on a small,
  auditable network surface.
- **Headless mode must keep working** (`pnpm build && pnpm start`, plain browser, no Electron).
  CI starts it and checks that `/` answers. Why: it is the deployment path for servers and containers.
- **The browser tool driver is selected by configuration** (`PISTA_BROWSER_DRIVER`, `pane` by default),
  so a headless driver can be added without touching tool code. Why: tools stay driver-agnostic.

## Conventions

- TypeScript strict, ESM imports with explicit extensions where the package requires it.
- Call out any new dependency in the PR description.
- Do not touch `pnpm-lock.yaml` by hand.
- Keep the UI shell-agnostic: anything Electron-specific goes behind
  `DesktopBrowserBridge` or `window.pistaDesktop`.
- Prefer small, reviewable diffs.
