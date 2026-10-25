# Pista integrations

This document describes how Pista connects to MCP servers, skills, plugins and MCP Apps. Facts are verified as of 2026-10-10.

## 1. Principles

- Do not invent formats. Configuration formats come from the standards that Claude Code, Codex and Pi have converged on.
- Runtime comes from Pi. Pista writes only the host glue, the UI, and the MCP Apps renderer.
- Every slice evaluates existing Pi packages before it writes new code. Its PR description says what was reused, what was written, and why.
- Pista is service-agnostic. There is no first-party connector directory. Users add any MCP server. The official MCP registry becomes browsable later.
- Pista must run as a headless server. All Pi state lives under `PISTA_HOME`. Secrets come from environment variables. The host binds to loopback only.

## 2. Standards adopted

| Standard | Used for | Who else uses it |
|---|---|---|
| `mcpServers` JSON map | MCP server config. Transports: stdio and streamable HTTP. SSE is deprecated and rejected by Pi. | Claude Code (`.mcp.json`, `~/.claude.json`), Cursor, Pi (`mcp.json`), Codex plugin (`mcp.json`) |
| Agent Skills `SKILL.md` | Skills with progressive disclosure. Only name and description go in the prompt. The body loads on demand. | agentskills.io, Claude Code, Codex, Pi |
| Agent Plugins `plugin.json` and `marketplace.json` | Plugins that bundle skills, `mcp.json` and hooks. | Codex. Codex reads Claude's `.claude-plugin/plugin.json` as a fallback. Pi loader: pi-agent-plugins |
| MCP Apps extension `io.modelcontextprotocol/ui` | Rich tool UI. A `ui://` HTML resource is declared in tool `_meta.ui.resourceUri`. It renders in a sandboxed iframe with a postMessage JSON-RPC bridge. | Rendered by Claude Desktop and ChatGPT. Not rendered by the Claude Code or Codex CLIs. Dropped by Pi's built-in MCP extension. |
| MCP tool annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`) | Approval policy | Claude Code (permission rules, requiresUserInteraction meta), Codex (writes approval mode, destructive_enabled / open_world_enabled gates), Pi (annotations on registered tools) |

## 3. What Pi 1.0.2 provides

We use these. We do not rebuild them.

- **MCP extension.** `createMcpExtension()` in `@earendil-works/pi-coding-agent`.
  - Reads `<agentDir>/mcp.json` and the trusted `<cwd>/.pi/mcp.json`.
  - Supports stdio and streamable HTTP, with `${ENV}` expansion.
  - OAuth with dynamic client registration and CIMD. Tokens go to `<agentDir>/mcp-auth.json`. The log goes to `<agentDir>/mcp.log`.
  - Per-server tool exposure: `codemode` (default), `deferred` (via tool_search), `direct`, `hidden`.
  - MCP resources through list and read tools.
  - Options hook: `loadConfig`, `createTransport`, `credentials`, `openUrl`, `updateConfig`.
- **Tool search and codemode extensions.**
- **Skills discovery** in `<agentDir>/skills`, `.pi/skills`, `~/.agents/skills`, `.agents/skills`, and a package's `skills/` folder.
- **Package system.** `pi install npm:|git:|<path>`. Packages use the `pi` manifest key in `package.json`. The gallery is at pi.dev/packages.
- **Agent dir.** Set with `PI_CODING_AGENT_DIR`. Otherwise `~/.pi/agent`.
- **Extension events.** `tool_call` can block. Others include `tool_result` and `session_start`. These are the hook mechanism. Pi has no built-in permission gating. Pista's approval gate is a `tool_call` extension.

**Known gaps in Pi 1.0.2.** These need upstream work or workarounds.

- `ServerState` (connection state) and the OAuth sign-in function are not exported from the package root.
- The only MCP event is `mcp_servers_change`. It covers register and unregister, not connect.
- MCP Apps `ui://` resources are dropped.

## 4. Pi community packages: reuse decisions

| Package | Decision | Reason |
|---|---|---|
| pi-mcp-adapter (nicobailon) | Do not use | Replaces Pi's built-in MCP. TUI-oriented. Its MCP UI opens native windows. We would lose native codemode and OAuth. |
| @gotgenes/pi-permission-system | Evaluate in the approval slice (3) | Allow, ask and deny at tool, bash, MCP server and tool level. Fails closed. Emits events a non-TUI host can answer. |
| pi-code (ilovepixelart) | Evaluate in the skills and hooks slices (4, 5) | Loads `.claude/skills`, Claude hooks.json, and installed Claude marketplace plugins. Single maintainer. Claude layout only. |
| pi-agent-plugins (BlockedPath) | Reference or fork in the plugins slice (5) | Loads the Agent Plugins format. Young. Depends on pi-mcp-adapter for MCP. |
| pi-memory, pi-web-access | Already bundled | Already in use |

## 5. Pista's own code

Pista writes these parts. Each one has a reason.

- **UI panels** for servers, OAuth state, skills and plugins. Every Pi package renders into a terminal UI. Pista's UI is React.
- **MCP Apps renderer.** Nothing in the Pi ecosystem renders `ui://` in a browser iframe. Pista reuses Pi's low-level `McpClient` from `@earendil-works/pi-mcp` to fetch resources.
- **Host glue.** The Pi agent dir under `PISTA_HOME`, config migration, and the approval gate.

## 6. Slices

| # | Slice | Scope | Verified by | Status |
|---|---|---|---|---|
| 1 | Pi state under PISTA_HOME. `mcp.json` is the source of truth. | Pi agent dir is `$PISTA_HOME/pi`, overridable with `PI_CODING_AGENT_DIR`. Migrate `mcpServers` from `config.json` to `mcp.json`. Add stdio. Fix the hyphenated-name namespace mismatch. Validate config instead of throwing. | Typecheck, headless start, existing servers connect | In progress |
| 2 | OAuth and connection status in the UI | Route Pi's `openUrl` to the shell. Show needs-auth. Add a login button. Add a paste-redirect fallback for headless use. Needs an upstream export of status and sign-in, or a workaround. | Manual OAuth login against a public MCP server, headless paste-redirect path exercised | Planned |
| 3 | Persistent approval policy | Per-server and per-tool allow, ask or deny in config. Writes-mode semantics: read-only annotated tools skip the prompt. Verify that codemode-originated MCP calls hit the gate. | Unit tests on the approval gate, including a codemode-originated MCP call | Planned |
| 4 | Skills panel | List loaded skills with source. Toggle them. Slash invocation in the composer. Add `.claude/skills` to discovery. | Browser check: skills listed with source, slash invocation works | Planned |
| 5 | Plugins | Agent Plugins loader: skills, `mcp.json`, and a hooks subset mapped to Pi events. Install from `marketplace.json` by git or URL, with pinning and a trust screen. | Install a sample plugin from a marketplace.json; its skills and MCP servers appear | Planned |
| 6 | MCP Apps | Spike first. Then fetch `ui://` resources, render them in a sandboxed iframe, add a postMessage bridge, and declare the CSP. | One reference MCP App renders in the iframe and can call back a tool | Planned |
| 7 | Registry import | Browse the official MCP registry (preview, API v0.1 frozen). Import by pasting JSON. | Browser check: registry search and paste-JSON import add a working server | Planned |

## 7. Comparison reference

| Topic | Claude Code | Codex | Pi | Pista plan |
|---|---|---|---|---|
| MCP config location | `.mcp.json`, `~/.claude.json` | Plugin `mcp.json` | `<agentDir>/mcp.json`, `<cwd>/.pi/mcp.json` | `$PISTA_HOME/pi/mcp.json` |
| Transports | stdio, streamable HTTP. SSE deprecated. | stdio, streamable HTTP. SSE deprecated. | stdio, streamable HTTP. SSE rejected. | stdio, streamable HTTP. No SSE. |
| OAuth | DCR and CIMD. Keychain. | DCR and CIMD. `auth = oauth or chatgpt`. Env var headers. | DCR and CIMD. `mcp-auth.json`. | Pi's |
| Tool exposure | Tool search by default. `alwaysLoad`. | tool_search by default. | codemode by default. `deferred` and `direct` available. | Pi's, set per server in the UI |
| Approvals | `mcp__server__tool` allow, ask and deny rules. `requiresUserInteraction` meta. | `default_tools_approval_mode`: auto, prompt, writes or approve, per tool, app or plugin. | None built in. | Pista `tool_call` gate (slice 3) |
| Skills discovery paths | `.claude/skills`, `~/.claude/skills` | `.agents/skills`, `~/.agents/skills` | `<agentDir>/skills`, `.pi/skills`, `.agents/skills` | Pi's, plus `.claude/skills` |
| Plugins | `.claude-plugin/plugin.json`, marketplaces | Root `plugin.json` (Agent Plugins), `.agents/plugins/marketplace.json` | Packages via npm and git | Agent Plugins and Pi packages |
| Hooks | 33 events | About 12 events | Extension events | Common subset, mapped to Pi events |
| Apps | Desktop renders MCP Apps. CLI does not. | Desktop status unclear. | Drops `ui://`. | Slice 6 |

## Sources

- code.claude.com/docs/en/mcp
- code.claude.com/docs/en/plugins-reference
- code.claude.com/docs/en/skills
- learn.chatgpt.com/docs/extend/mcp
- learn.chatgpt.com/docs/plugins
- modelcontextprotocol.io/specification/latest
- modelcontextprotocol.io/extensions/apps/overview
- pi.dev/packages
- github.com/earendil-works/pi
- agentskills.io
