# Managed policy

An organisation can deploy Pista with preconfigured settings and lock some of them. The admin owns a JSON file; the host reads it once at startup, never writes it, and logs what it loaded. With no file, nothing changes.

## Where the file lives

The host uses the first of these that applies:

1. `PISTA_POLICY_FILE`, if set. A path that does not exist is logged as a warning and no policy is applied.
2. macOS: `/Library/Application Support/Pista/managed-policy.json`
3. Linux: `/etc/pista/managed-policy.json`
4. Windows: `%ProgramData%\Pista\managed-policy.json`

Make the file writable only by administrators; the host only needs to read it.

## Schema

```json
{
  "version": 1,
  "locked": { "approvalMode": "ask-writes", "webSearchEnabled": false },
  "defaults": { "maxOutputTokens": 8192 }
}
```

- `version`: must be `1`. Anything else, or invalid JSON, and the whole file is ignored with a warning.
- `locked`: settings forced to these values. The UI shows them as managed and the host rejects `config.set` patches that touch them. They are never written to the user's `config.json`.
- `defaults`: values for every setting the user has never changed themselves. They are applied at each startup, so a changed default reaches existing installs, and are written to `config.json`. Once the user changes a key in Settings, their value stays.

Keys are the `HostConfig` settings (see `packages/protocol`). Unknown top-level keys, unknown settings and values of the wrong type are skipped with a warning; the rest of the file still applies.

- A file that is missing, unreadable or invalid fails open: the host logs a warning and applies no policy, so nothing is locked.
- `maxOutputTokens: null` means no cap.
- `mcpServers` cannot be set in `locked` or `defaults`; use the `mcp` section described under MCP servers below.
- `providers`, `models`, `mcp`, `extensions` and `tools` are documented under Gateway providers, Allowlists and direct login, MCP servers, Extensions and skills, and Tool rules below.
- A default for a key that is also locked is ignored with a warning.
- The host warns when the file is writable by group or others.

## Gateway providers

Route all model traffic through the company gateway (LiteLLM, Portkey, Azure, an internal proxy) by declaring it under `providers.gateways`. The host registers each one at startup, like the built-in Nebius provider, and its models appear in the model list.

```json
{
  "version": 1,
  "providers": {
    "gateways": [
      {
        "id": "corp-llm",
        "name": "Corp LLM Gateway",
        "kind": "openai-compatible",
        "baseUrl": "https://llm.example.com/v1",
        "apiKeyEnv": "LLM_GATEWAY_KEY",
        "headers": { "X-Team": "$PISTA_TEAM" },
        "models": [
          { "id": "claude-sonnet", "name": "Claude Sonnet", "contextWindow": 200000, "maxTokens": 16384, "reasoning": true },
          { "id": "gpt-4o", "name": "GPT-4o", "contextWindow": 128000 }
        ]
      }
    ]
  }
}
```

- `id`: provider id shown in the UI and used in model refs (`{ "provider": "corp-llm", "id": "gpt-4o" }`). Letters, digits, `.`, `_` and `-`, starting with a letter or digit. It must be unique and must not collide with a provider that already exists (`nebius`, `llama.cpp`, `ollama` and the other local server kinds, a `local-` prefix, or any Pi built-in such as `anthropic` or `openai`); a colliding gateway is skipped with a warning.
- `kind`: `openai-compatible` (chat completions) or `anthropic-compatible` (messages API). For `anthropic-compatible`, give a `baseUrl` without a `/v1` suffix: the client appends `/v1/messages` itself.
- `baseUrl`: must be `https`, except `http` for `localhost` and `127.0.0.1`. Credentials, a query string or a fragment in the URL are rejected; a trailing `/` is removed.
- `apiKeyEnv`: the name of the environment variable that holds the key, set in the host's environment. **Keys are never written in the policy file.** While the variable is unset at startup the provider counts as unconfigured: it is registered, the host logs a warning, and its models stay hidden until the variable is set (restart the host after setting it).
- `headers`: static headers sent with every request. Values may only be literals or `$NAME` / `${NAME}` references to environment variables. A value starting with `!` is rejected (the whole gateway is dropped) because Pi would run it as a shell command. An unset referenced variable draws a warning, and a long literal value draws a warning because it is probably a secret.
- `models`: at least one. `name`, `contextWindow` (default 128000), `maxTokens` and `reasoning` are optional.

An invalid gateway is skipped with a warning and the rest of the file still applies. A registration error is also reported as a warning and never stops the host from starting. The startup log line reports the count, for example `managed policy: <path>, 0 locked, 0 defaults, 1 gateways`.

## Sign-in with your identity provider

Instead of a provisioned key, a gateway can let employees sign in with the company's OIDC identity provider (Okta, Microsoft Entra ID, Auth0, Keycloak). The IdP must allow the device flow for a public client without a client secret; identity providers that require a client secret for it (Google, for example) are not supported. The host uses the OAuth 2.0 device authorization grant (RFC 8628): Settings shows a short code and a link, the employee opens the link on any browser, enters the code and signs in, and the host receives the tokens. Declare it with `auth` instead of `apiKeyEnv`; the two are mutually exclusive (a gateway with both is dropped with a warning).

```json
{
  "version": 1,
  "providers": {
    "gateways": [
      {
        "id": "corp-llm",
        "name": "Corp LLM Gateway",
        "kind": "openai-compatible",
        "baseUrl": "https://llm.example.com/v1",
        "auth": {
          "type": "oidc",
          "issuer": "https://login.microsoftonline.com/<tenant-id>/v2.0",
          "clientId": "00000000-0000-0000-0000-000000000000",
          "scopes": ["api://corp-llm/.default"]
        },
        "models": [{ "id": "gpt-4o" }]
      }
    ],
    "disableDirectLogin": true
  }
}
```

An Okta issuer looks like `https://acme.okta.com/oauth2/default` (scope `offline_access` is requested for you; add the scopes your gateway expects).

- `issuer`: `https` URL without credentials, query or fragment. The host reads `<issuer>/.well-known/openid-configuration` and needs `device_authorization_endpoint` and `token_endpoint` in it; the `issuer` in the document must match.
- `clientId`: the public client id of your app registration. There is no client secret.
- `scopes`: optional. `openid` and `offline_access` are always requested; add the scopes or resource your gateway needs.
- `token`: `"access"` (default) or `"id"`. This is the token sent to the gateway as `Authorization: Bearer`. Use `"id"` only if the gateway validates ID tokens.
- `audience`: optional, sent as `audience` on the device authorization request (Auth0 style).

An `anthropic-compatible` gateway receives the token in both `x-api-key` and `Authorization: Bearer`, so the gateway should read the bearer header.

What the IdP app registration needs: a public (no secret) client with the device authorization grant enabled, refresh tokens allowed (`offline_access`; on Entra, allow public client flows and grant the API permission), and the gateway's API or audience among the allowed scopes. Entra does not return a ready-made link with the code in it, so employees type the code on the page the host shows.

How it behaves:

- Settings shows the gateway with a "Sign in with <name>" button and an SSO label. Clicking it opens a panel under the provider with the one-time code in large type and a Copy button, the verification link, an Open sign-in page button, an "Expires in m:ss" countdown, and a Cancel button that aborts the sign-in. The desktop app also opens the link in the system browser by itself; a plain browser does not, so popup blockers cannot hide the code. When sign-in completes the row reads "Signed in as <subject>" (the subject is shown until the host restarts; Pi's stored credential is not readable by the host).
- Tokens are stored by Pi in `auth.json` under `$PISTA_HOME/pi` (outside the policy file, never logged). A stored sign-in belongs to the gateway; no environment variable is consulted.
- The token is refreshed before it expires (when less than five minutes remain) using the refresh token, and the rotated refresh token is stored if the IdP issues one. When the IdP no longer accepts the refresh token (revoked, password reset, session limit) the request fails with "Sign in again to <name>".
- The only outbound calls are to the discovery, device authorization and token endpoints of the configured issuer.
- `providers.disableDirectLogin` does not block this sign-in: it only closes the built-in providers and API-key logins. An SSO gateway stays visible and signable when `providers.allow` lists it.
- The host does not verify the ID token signature; it only reads `sub` and `exp`. The gateway is the party that validates the bearer.
- Not implemented yet: authorization code with PKCE and a loopback redirect, which would avoid typing a code.

## Allowlists and direct login

Restrict which providers and models employees can use, and stop them from signing in to providers themselves. Absent settings change nothing.

```json
{
  "version": 1,
  "providers": {
    "gateways": [
      {
        "id": "corp-llm",
        "name": "Corp LLM",
        "kind": "openai-compatible",
        "baseUrl": "https://llm.example.com/v1",
        "apiKeyEnv": "CORP_LLM_KEY",
        "models": [{ "id": "gpt-4o" }, { "id": "claude-sonnet" }, { "id": "llama-70b" }]
      }
    ],
    "allow": ["corp-llm"],
    "disableDirectLogin": true
  },
  "models": { "allow": ["corp-llm/gpt-4o", "corp-llm/claude-sonnet"] }
}
```

This allows only the gateway, only two of its models, and no direct sign-in.

- `providers.allow`: provider ids (built-in ids and gateway ids) that may be used. Absent means all. An empty list means none, and so does a value that is not an array (the host warns and treats it as empty). An id that is neither built-in nor a declared gateway draws a warning but is kept.
- `models.allow`: entries `provider/id` or `provider/*`. Absent means every model of the allowed providers. When both lists are set, a model must be on an allowed provider and match an entry. The id part may contain slashes (`openrouter/anthropic/claude-x`). Matching is case-sensitive and entries are trimmed.
- `providers.disableDirectLogin`: when `true`, the host rejects `auth.login` for every provider and the Settings Providers tab offers no sign-in buttons. Gateways are unaffected because they authenticate with the key in their `apiKeyEnv` variable. The exception is a gateway with `auth` (see Sign-in with your identity provider), whose OAuth sign-in stays available. A value that is not a boolean warns and counts as `false`. Provider rows in Settings show a Managed badge instead of sign-in buttons.

Where it applies: the model picker and the Providers tab only list allowed models and providers; `thread.setModel` and `auth.login` outside the lists fail with `Not allowed by your organisation's policy: <provider>/<id>`. A new or restored thread whose model is not allowed starts on the first allowed model instead (the host logs one line): gateway models first, in policy order, then the rest sorted by `provider/id`. When nothing is allowed it fails with the error above; when allowed models exist but none is configured it fails with `No allowed model is configured; set <apiKeyEnv>`, naming the gateway's key variable. A restored thread never stays on a disallowed model. Goal checks use the same rule for the default model. A sub-agent role model that is not allowed uses the parent's model. Starting the built-in llama.cpp runtime or downloading its models, and adding a local model server, are refused unless `providers.allow` includes `llama.cpp` or the server's provider id (`lmstudio`, `ollama`, `llamacpp`, `local-<port>`). The `host.hello` policy also carries `providers` and `models` so a client can explain why something is missing.

An invalid entry is dropped with a warning and the rest of the file still applies; note that dropping every entry of an allowlist leaves it empty, which allows nothing. The startup log line gains `, allow <p> providers / <m> models, direct login <on|off>` when any of these is set.

## MCP servers

```json
{
  "version": 1,
  "mcp": {
    "servers": {
      "corp-docs": {
        "command": "npx",
        "args": ["-y", "@acme/docs-mcp"],
        "env": { "DOCS_TOKEN": "${DOCS_TOKEN}" },
        "exposure": "deferred"
      }
    },
    "blockedServers": ["filesystem"],
    "allowUserServers": false
  }
}
```

- `servers`: a map of name to entry, in the standard `mcpServers` format that Pi's `mcp.json` uses (`command`, `args`, `env`, `cwd` or `url`, `headers`, plus `exposure`, `enabled`, `timeout`, `description` and Pi-only keys such as `toolExposure`). The host writes them into `$PISTA_HOME/pi/mcp.json` at every start, so Pi connects to them like any other server. A user entry with the same name is replaced. Names use letters, digits, `_` and `-`; `-` and `_` count as the same character, as in Pi.
- Keep secrets out of the file: use `${ENV}` references in `env`, `headers` and `args`, set in the environment where the host starts. A value over 40 characters without a reference draws a warning, but the server is kept.
- `blockedServers`: names removed from `mcp.json` at startup and refused afterwards. A name that is both declared and blocked counts as blocked, with a warning.
- `allowUserServers`: `false` stops employees adding servers. Editing or removing the servers they already have stays possible; only additions are refused. Default `true`.
- An invalid server (bad name, no `command` or `url`, wrong types) is dropped with a warning and the rest still apply. The startup log gains `[pista-host] managed mcp: <n> servers, <b> blocked, user servers <allowed|disabled>`.

In Settings, managed servers show a Managed badge and have no Remove button; when `allowUserServers` is `false` the add control is replaced by a note. The host enforces the same rules: a `config.set` that changes or removes a managed server, adds a blocked name, or (with `allowUserServers: false`) adds any server fails with `Not allowed by your organisation's policy: ...`. `host.hello` carries `policy.mcp` (`managedServers`, `allowUserServers`).

When the host starts it also removes the servers the previous start installed, so a server dropped from the policy, or a policy that is removed, takes its servers out of `mcp.json`. The names installed are remembered as `managedMcp` in `config.json`.

If the policy cannot be trusted at startup, the host leaves `mcp.json` and the `managedMcp` list untouched and logs a warning: the file failed to load (unreadable, wrong `version`, or a `PISTA_POLICY_FILE` that does not exist), or `mcp`, `mcp.servers` or `mcp.blockedServers` has the wrong type. Previously installed servers stay and blocks stay in place. Only a successfully loaded policy without an `mcp` section (or no policy file at the platform path) uninstalls what an earlier start installed.

A managed entry is checked against what Pi accepts: `exposure`, `enabled`, `timeout`, `description`, `cwd`, `toolExposure` and `type` (`stdio`, `http` or `streamable-http`; `sse` is rejected) must have valid values, otherwise the server is dropped with a warning instead of being installed dead. The names `__proto__`, `constructor` and `prototype` are refused.

Limits, and what is not enforced:

- Reconciliation happens only at startup. Between starts, changes made outside the Settings screen are not checked until the next start.
- Pi runs a whole-value `!command` in `env` and `headers` as a shell command. In a managed entry that is the admin's choice; in a user's entry it is a way to run commands.
- Ways around the Settings rules: `pi mcp add` and `pi mcp remove` in a shell, the in-session `/mcp` command, the agent's own shell writing `mcp.json`, hand edits, and a trusted project's `.pi/mcp.json` (an entry with the managed name and `{"enabled": false}` switches a managed server off for that project, and project files can add servers). All of these take effect until the next start restores `mcp.json`; project files are never reconciled.
- Pi has no allowlist and a `command` runs any executable, so `allowUserServers: false` only closes the Settings path. The behavioural enforcement is tool-level rules (which tools of which server may run), which come in a later slice.

## Extensions and skills

Pi extensions, skills and prompt templates ship as Pi packages. The policy decides which packages every employee gets and whether they may add their own.

```json
{
  "version": 1,
  "extensions": {
    "packages": ["npm:@acme/pi-guardrails@1.4.0", "git:github.com/acme/pi-skills#v2.1.0"],
    "allowUserPackages": false
  }
}
```

- `packages`: sources written into the `packages` setting of `$PISTA_HOME/pi/settings.json` every time a session is built, so a new package reaches the next thread without a restart. Sources are `npm:<name>@<exact-version>`, a git source with a ref (`git:github.com/org/repo#v1.2.3` or `@v1.2.3`, also `https://`, `ssh://` and `git@host:` URLs), or a local path. Employees cannot keep their own filtered copy of a managed source when `allowUserPackages` is `false`.
- Pinning is required: an `npm:` source without an exact version (`@1.2.3`, no ranges or tags) and a git source without a ref are dropped with a warning. Pi has no lockfile or integrity check, so the pin is the only control; prefer a commit SHA or an immutable tag over a branch, since a branch moves. A local path is accepted with a warning, because it must exist on every machine.
- `allowUserPackages`: `false` removes every other entry from `packages` and keeps them out; `true` (the default) keeps what employees added. Each removal is logged once with the dropped sources.
- A package removed from the policy, or the whole section removed, is taken out of `settings.json` on the next session build. The sources the policy installed are remembered as `managedPackages` in `config.json`. The file is rewritten only when the list changes.
- `host.hello` carries `policy.extensions` (`managedPackages`, `allowUserPackages`). The startup log line gains `, <n> packages` and, when applicable, `, user packages disabled`.

Limits:

- Only the `packages` setting is managed. Files copied by hand into `<agent-dir>/extensions`, `<agent-dir>/skills` or `<agent-dir>/prompts`, and skills in `~/.agents/skills`, load regardless. For behaviour, the tool-level rules in the `tools` section are what is enforced.
- Packages declared in a trusted project's `.pi/settings.json` are not controlled by this section: Pi lets project entries win over the user-level list, so a trusted project can load packages the policy never listed. Project trust is the control there.
- A user's own copy of a managed source (for example a filtered entry for the same package) is removed too when the policy later drops that source.
- A branch ref passes validation but is not immutable: it moves with the branch. Pin a commit SHA or a tag.
- A relative local path in `packages` resolves from the agent directory (`$PISTA_HOME/pi`), the folder holding `settings.json`; prefer absolute paths.
- If the settings file cannot be written, or Pi cannot install or load a managed package, the session fails to start with an error beginning `managed policy:` instead of running without the policy.
- An npm package installs with its lifecycle scripts, and a git or npm package runs code with the employee's permissions. Review what you pin.
- Pi fetches npm and git packages over the network at first use, into `<agent-dir>/npm` and `<agent-dir>/git`. Machines without access to the registry or git host need the packages mirrored or preinstalled.

## Tool rules

The `tools` section restricts which tools, shell commands, MCP servers and tools, and skills the agent may use. The host enforces it on every tool call, whatever the user installs.

```json
{
  "version": 1,
  "tools": {
    "bash": { "deny": ["rm -rf *", "git push*", "sudo *"] },
    "mcp": { "deny": ["slack"] }
  }
}
```

To allow only one MCP server, use `"mcp": { "allow": ["github"] }`. All fields are optional:

| Field | Meaning |
|---|---|
| `allow` | Tool names. When present, only these tools run (default-deny). |
| `deny` | Tool names that never run. |
| `bash.allow` / `bash.deny` | Patterns over the command units of a shell command. |
| `mcp.allow` / `mcp.deny` | `"server"` or `"server/tool"`; matched against the tool `mcp__<server>__<tool>`. `-` and `_` count as one character, as in Pi, and case is ignored. The server is matched exactly against the part after `mcp__` up to the next `__`; an entry whose server name contains `__` is dropped with a warning. `deny` also looks through Pi's `_<8 hex>` suffix for colliding tool names, `allow` does not. |
| `skills.allow` / `skills.deny` | Skill names. `"allow": []` loads no skills. |

Patterns are `*` and `?` globs and are case-sensitive (except `mcp`). A trailing ` *` also matches the bare command (`git push *` matches `git push`). Tool names are Pi's: `bash`, `edit`, `write`, `read`, `browser_click`, `mcp__github__create_issue`, and so on.

**Evaluation order.** Deny beats allow at every level, and every level that is present must pass: `tools.deny`, then `tools.allow`, then for MCP tools `mcp.deny` and `mcp.allow`, then for shell tools (`bash`, `powershell`) the `bash` rules. An `allow` list that is present means "only these"; an empty one allows nothing. Pista's own tools (`agent`, `plan`, `tool_search`, `codemode`) are implicitly allowed under `tools.allow`; `tools.deny` still applies to them. Tools called from a codemode script are checked one by one, so allowing `codemode` does not allow what it calls.

**Shell commands.** A command is cut into units at `;`, `&`, `&&`, `||`, `|`, newlines, `$(`, backticks and parentheses, and the payloads of `sh -c`, `bash -c` (also with a path, long flags such as `--login`, `fish`, `zsh`, `busybox sh`) and `eval` are unpacked, four levels deep. Runs of spaces and tabs count as one space and backslash-newline continuations are removed before matching. Each unit is matched as a whole, so use a trailing `*` for arguments: `git push*`. A command longer than 8192 characters is refused under any rule set.

- `bash.deny` is lenient: it also tries the unit without leading `VAR=value` assignments, without wrappers (`env`, `command`, `exec`, `nohup`, `time`, `xargs`, `nice`, `timeout`, `stdbuf`, `setsid`, `doas`, `sudo`, `ssh <host>`), with shell keywords (`then`, `do`, ...) removed, and with the program name unquoted and without its directory (`/usr/bin/git` is `git`). It also matches the whole command, so `curl*|*sh` works.
- `bash.allow` is strict: every unit must match an allow pattern exactly as written (shell keywords aside). `./git status`, `/tmp/x/ls`, `FOO=1 ls`, `env ls` and `xargs ls` do not match `git status*` or `ls*`.

The host's own shell (the UI's direct shell and the goal acceptance check) applies the same rules, and also refuses when `bash` itself is denied. A goal check the rules refuse ends in a check error, which pauses the goal with the reason.

**Which tools `tools.allow` must list.** Under `tools.allow`, only your list and Pista's own tools (`agent`, `plan`, `tool_search`, `codemode`) run. Everything else Pista bundles is *not* implicitly allowed and must be listed if you want it:

- `read`, `grep`, `find`, `ls`, `edit`, `write`, `bash` (Pi's built-ins; `powershell` on Windows).
- `browser_navigate`, `browser_snapshot`, `browser_read`, `browser_screenshot`, `browser_scroll`, `browser_back`, `browser_click`, `browser_type`, `browser_select`, `browser_press`, and `browser_eval`. They are left out on purpose: the browser acts with the user's logged-in sessions. Deny the family (`"browser_*"`) rather than single tools.
- `memory_*` and `scratchpad` (pi-memory), and `web_search` and `fetch_content` (pi-web-access), when memory and web search are enabled.
- `list_mcp_resources`, `list_mcp_resource_templates` and `read_mcp_resource`, and every `mcp__<server>__<tool>`; MCP tools also have to pass the `mcp` rules.

A starter allowlist for a read-mostly setup: `"allow": ["read", "grep", "find", "ls", "edit", "write", "bash", "mcp__*"]` together with `bash` and `mcp` rules.

**Guaranteed.**

- Every tool call the model makes, including nested codemode calls and MCP tools, passes the gate. The gate is the last extension to run, so it sees the input as user and project extensions left it, and a block cannot be overridden by them.
- A rule that cannot be evaluated blocks the call (fail closed). A blocked call returns `Blocked by your organisation's policy: <rule>` to the model; the user is not asked to approve it, and approval mode cannot override it.
- Denied tools are hidden from the model at the start of each run where possible; the gate is what enforces.
- Denied skills are never loaded, so they are not offered and `/skill:<name>` does not exist. Skills are matched by name (the frontmatter `name`, else the folder name).
- MCP resource tools (`list_mcp_resources`, `read_mcp_resource`, ...) must name a server when `mcp` rules exist, and are checked against the server rules.
- A malformed section fails closed: a `tools` value that is not an object counts as `{ "deny": ["*"] }`, a wrong-typed `deny` as `["*"]`, a wrong-typed `allow` as `[]`. Bad entries inside a list are dropped with a warning.

**Not guaranteed.**

- Extensions installed by hand that run code directly (spawning processes, calling APIs) without going through a tool call are not stopped. A user extension can also replace `codemode` or `tool_search`. Constrain what gets installed with the `extensions` section; `extensions.allowUserPackages: false` is the mitigation.
- MCP tools that themselves run commands (a "shell" or "exec" tool on a server) are governed by the `mcp` rules only; the `bash` rules do not apply to them.
- A missing, unreadable or invalid policy file fails open for the whole policy, tool rules included. Make the file root-owned and monitor the startup warning.
- Shell patterns are best effort. Not understood: here-strings and heredocs fed to a shell (`bash <<< '...'`), `echo ... | sh`, flag variants (`rm -fr`, `rm -r -f`), options before the subcommand (`git -C . push`, `git -c x=y push`), variables and expansions (`${IFS}`, `$cmd`), redirects such as `> file` that slip past allow lists, and PowerShell, which goes through the same POSIX splitter. Also variables, aliases, scripts and escapes inside an allowed command (`python -c`, `find -exec`, `git -c alias.x=...`) can still do what a denied pattern names. A skill file can still be read with `read`. The real boundary is an OS sandbox or a container.
- File changes made with `edit` and `write` are not restricted unless you deny those tools.
- Separators inside quotes also split a command (conservative: more matches for deny, fewer for allow), and heredoc bodies are checked line by line.

## Precedence

locked > user-set > policy `defaults` > built-in default.

The host records which settings the user changed in `userSet` in `config.json`. For an install that predates this, the first run treats every setting that differs from the built-in default as user-set, so earlier choices are not overridden by a newly deployed default. A user value that happens to equal the built-in default is not detected as a choice, so a policy default replaces it.

## Deployment

Web deployments run one host per user. Mount the policy file at the platform path inside the container, or point `PISTA_POLICY_FILE` at it. The desktop app starts its own host, which reads the platform path.

## Not covered yet

Audit logging and update control.
