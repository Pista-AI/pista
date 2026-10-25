# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-25

First public release.

### Added

- Desktop app (Electron) with a React UI: projects and threads in a sidebar, streamed transcript with a collapsible work log, composer with model picker, reasoning effort and image attach, and a side panel with Browser, Terminal and Tools.
- Built-in browser pane (a Chromium `WebContentsView` in the desktop app, an iframe fallback in a plain browser) that the agent drives alongside the chat.
- Agent host sidecar (Node) built on the Pi SDK, one session per thread, talking to the UI over a typed WebSocket protocol (`@pista/protocol`) bound to loopback with an origin check.
- Permission modes (Read only, Default, Full access) with inline approval cards that can carry a note back to the agent.
- MCP integration: servers are stored in `$PISTA_HOME/pi/mcp.json` in the standard `mcpServers` format (stdio and streamable HTTP), managed from Settings, with `${ENV_VAR}` token references.
- `@pista/pi-browser`: `browser_*` tools with ref-based page snapshots, context collapsing of old page views, and safety stops (cookie banners declined, consequential clicks and submits held for approval, password fields never typed into).
- Pluggable browser driver: the app's `pane` (default) or any Chromium over CDP (`PISTA_BROWSER_DRIVER=cdp`), plus a headless eval suite for the browser tools.
- Built-in local runtime: an opt-in, hash-verified, supervised llama.cpp `llama-server` in router mode with Hugging Face model search and download, bundled into the macOS arm64 app (`@pista/local-runtime`). Windows and Linux assets are pinned but untested on real hardware.
- Local model servers: LM Studio and Ollama are detected and listed in the model picker.
- Model providers through Pi (subscription sign-in and API keys from Settings or environment variables), plus a built-in Nebius Token Factory provider (`NEBIUS_API_KEY`).
- Guards for small local models: pruning of past reasoning and bulky tool results, a loop guard, and temperature 0 on browsing turns.
- Long-running work: goals with a checker, plans, sub-agent roles, a decisions log, and cross-thread memory.
- Project trust: a project's own `.pi/` resources (MCP servers, extensions, skills) load only for trusted projects.
- Managed policy file for organisations: locked and default settings, gateway providers, OIDC sign-in via the device flow, provider and model allowlists, MCP, extension and skill allowlists, and tool rules (see `docs/ENTERPRISE.md`).
- Headless server mode (`pnpm build && pnpm start`) with all state under `PISTA_HOME`, a Dockerfile, and CI that typechecks, tests and smoke-tests the headless host.
- macOS packaging with ad-hoc signing by default, opt-in Developer ID signing and notarization, and a tagged-release CI workflow (see `docs/release-signing.md`).

[Unreleased]: https://github.com/Pista-AI/pista/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Pista-AI/pista/releases/tag/v0.1.0
