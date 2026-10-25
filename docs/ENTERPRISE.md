# Managed policy

An organisation can deploy Pista with preconfigured settings and lock some of them. The admin owns a JSON policy; the host reads it once at startup, never writes it, and logs what it loaded. With no policy, nothing changes. A changed policy reaches the host only after a restart, see [When changes take effect](#when-changes-take-effect).

## Where the policy lives

The host uses the first local source that applies. One source is used; policies are never merged. A signed policy fetched from a URL (see Policy from a URL below) is configured from a local policy and, once verified, replaces it entirely.

1. `PISTA_POLICY_FILE`, if set. A path that does not exist is logged as a warning and no policy is applied.
2. MDM (see [Delivery through MDM](#delivery-through-mdm)): macOS managed preferences or the Windows HKLM policy key.
3. macOS: `/Library/Application Support/Pista/managed-policy.json`
4. Linux: `/etc/pista/managed-policy.json`
5. Windows: `%ProgramData%\Pista\managed-policy.json`

Make the file writable only by administrators; the host only needs to read it.

### Delivery through MDM

IT can push the same JSON through the device management channel instead of a file. The payload is one string value, either `PolicyJSON` (the JSON text) or `PolicyJSONBase64` (base64 of the JSON). Setting both is an error. The text goes through exactly the same validation as the file.

- macOS: a Configuration Profile with a `com.apple.ManagedClient.preferences` payload for the domain `app.pista.desktop`, which lands in `/Library/Managed Preferences/app.pista.desktop.plist`. Only that device-scope file is read; user-scope managed preferences are not. The host uses it only if it is a regular file owned by root and not writable by group or others; otherwise it is a failure, never silently used. Template: [`enterprise/pista.mobileconfig`](enterprise/pista.mobileconfig).
- Windows: the value `PolicyJSON` or `PolicyJSONBase64` (REG_SZ or REG_EXPAND_SZ) under `HKLM\SOFTWARE\Policies\Pista`. HKCU is never read, since users can write it. A missing key means no MDM policy; a key that exists but cannot be read stops the host. Template: [`enterprise/pista-policy.reg`](enterprise/pista-policy.reg). Intune can set the value through a registry or OMA-URI setting or a script. `reg.exe` writes and reads in the OEM codepage, so for a policy with non-ASCII text use `PolicyJSONBase64`. No ADMX is shipped: a whole JSON document in an ADMX text element is awkward to author and validate.
- Linux has no MDM source; use the file.

An MDM source that exists but cannot be used (unsafe ownership, both keys, bad base64, bad JSON) stops the host; it does not fall through to the file. A macOS plist with neither key is treated as no MDM policy, with a warning. `pista policy check` prints `Policy source: mdm — <where>` (or `env-file`, `file`, `url`, `none`), and `--json` has `sourceKind`.

### Policy from a URL

IT can publish a signed policy bundle on its own HTTPS URL instead of pushing a file to every machine. The bundle is signed with an Ed25519 key you keep; the host trusts only the public key.

At startup the host loads the local bootstrap policy (MDM or file) first, applies its `network` and `telemetry` settings so the fetch goes through your proxy and CA, then fetches and verifies the bundle. A verified remote policy replaces the bootstrap policy entirely; nothing is merged. While running, the host re-fetches every `refreshMinutes`. A newer serial is only logged (`managed policy updated to serial N; restart Pista to apply it`); see [When changes take effect](#when-changes-take-effect).

Create a key pair once, and keep `policy-signing.pem` private:

```
openssl genpkey -algorithm ed25519 -out policy-signing.pem
openssl pkey -in policy-signing.pem -pubout -out policy-signing.pub.pem
```

Write the policy as usual and add an integer `"serial"` (0 or more). Raise it on every publish. Sign it and publish the output on your URL:

```
pista policy sign --key policy-signing.pem policy.json > policy.bundle.json
pista policy sign --key policy-signing.pem --out policy.bundle.json policy.json
```

The bundle is one JSON file: `{"format":"pista-signed-policy/1","payload":"<base64 of the policy JSON>","signature":"<base64 of the 64-byte Ed25519 signature over the decoded payload>"}`. The payload must not contain `policySource` (no chaining).

Point a machine at the URL with a `policySource` block in the local policy (MDM or file), or with environment variables, which win over the block:

```json
{ "version": 1, "policySource": { "url": "https://policy.example.com/pista.json", "publicKeyFile": "/etc/pista/policy-signing.pub.pem", "refreshMinutes": 60 } }
```

- `url` must be `https:` (plain `http:` only for `localhost`, for tests). Redirects are refused.
- Exactly one of `publicKey` (the PEM text) and `publicKeyFile` is required.
- `refreshMinutes` defaults to 60; the minimum is 15.
- Env: `PISTA_POLICY_URL` and `PISTA_POLICY_PUBLIC_KEY` (PEM text, or a path when the value does not start with `-----BEGIN`). A URL without a key is an error.
- An invalid `policySource` is a load failure, never silently ignored. An invalid `PISTA_POLICY_URL` or key setting stops the host even without `PISTA_REQUIRE_POLICY`.
- CA certificates and telemetry-off set by the bootstrap policy are not undone by the remote policy; proxy settings are.
- Precedence: `PISTA_POLICY_URL` wins over `policySource` in the bootstrap policy. An invalid env setting stops the host.
- Fail closed: if the fetch and the cache both fail, the host keeps the bootstrap policy with a warning, or refuses to start when `PISTA_REQUIRE_POLICY=1`. `pista policy check` does a live fetch and reports the URL, origin (fetched or cache), serial and cache age, or the failure.

Anti-rollback: the host compares the serial with the cached one. A bundle with a lower serial is rejected and the cached one stays in force. The last good bundle is cached, unchanged, at `$PISTA_HOME/policy/remote-policy.json` and verified again on every read. When the URL cannot be reached or the bundle does not verify, the cache is used with a warning that includes its age.

Accepted limits: the cache is writable by the user, so deleting it removes the rollback floor (an older bundle still needs your signature, so do not leave old bundles at the URL). A cached bundle has no maximum age.

## Schema overview

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

Keys are the `HostConfig` settings (see `packages/protocol`). Unknown top-level keys, unknown settings and values of the wrong type are skipped with a warning; the rest of the file still applies. The exception is the strict blocks (`network`, `telemetry`, `browser`, `updates`, `audit`, `retention` and `policySource`), where they stop the host (see [Fail closed](#fail-closed)).

- A policy that is missing fails open: the host logs a warning and applies no policy, so nothing is locked (see [Fail closed](#fail-closed) to change that). A policy that exists but cannot be read, is not valid JSON, has no `version: 1`, or has a malformed strict block stops the host.
- `maxOutputTokens: null` means no cap.
- `mcpServers` cannot be set in `locked` or `defaults`; use the `mcp` section (see [MCP servers](#mcp-servers)).
- `providers`, `models`, `mcp`, `extensions`, `tools`, `network`, `telemetry`, `browser`, `updates`, `audit`, `retention` and `policySource` have their own sections below.
- A default for a key that is also locked is ignored with a warning.
- The host warns when the file is writable by group or others.

## Precedence

locked > user-set > policy `defaults` > built-in default.

The host records which settings the user changed in `userSet` in `config.json`. For an install that predates this, the first run treats every setting that differs from the built-in default as user-set, so earlier choices are not overridden by a newly deployed default. A user value that happens to equal the built-in default is not detected as a choice, so a policy default replaces it.

## Providers and gateways

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

## Sign-in

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

## Allowlists

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
- `providers.disableDirectLogin`: when `true`, the host rejects `auth.login` for every provider and the Settings Providers tab offers no sign-in buttons. Gateways are unaffected because they authenticate with the key in their `apiKeyEnv` variable. The exception is a gateway with `auth` (see [Sign-in](#sign-in)), whose OAuth sign-in stays available. A value that is not a boolean warns and counts as `false`. Provider rows in Settings show a Managed badge instead of sign-in buttons.

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
- Pi has no allowlist and a `command` runs any executable, so `allowUserServers: false` only closes the Settings path. The behavioural enforcement is the tool-level rules (which tools of which server may run), see [Tool rules](#tool-rules).

## Extensions

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

- `packages`: sources written into the `packages` setting of `$PISTA_HOME/pi/settings.json` every time a session is built, so after a host restart (see [When changes take effect](#when-changes-take-effect)) the next thread gets the new list. Sources are `npm:<name>@<exact-version>`, a git source with a ref (`git:github.com/org/repo#v1.2.3` or `@v1.2.3`, also `https://`, `ssh://` and `git@host:` URLs), or a local path. Employees cannot keep their own filtered copy of a managed source when `allowUserPackages` is `false`.
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
- A missing policy file fails open for the whole policy, tool rules included, unless `PISTA_REQUIRE_POLICY=1` is set (see [Fail closed](#fail-closed)). Make the file root-owned.
- Shell patterns are best effort. Not understood: here-strings and heredocs fed to a shell (`bash <<< '...'`), `echo ... | sh`, flag variants (`rm -fr`, `rm -r -f`), options before the subcommand (`git -C . push`, `git -c x=y push`), variables and expansions (`${IFS}`, `$cmd`), redirects such as `> file` that slip past allow lists, and PowerShell, which goes through the same POSIX splitter. Also variables, aliases, scripts and escapes inside an allowed command (`python -c`, `find -exec`, `git -c alias.x=...`) can still do what a denied pattern names. A skill file can still be read with `read`. The real boundary is an OS sandbox or a container.
- File changes made with `edit` and `write` are not restricted unless you deny those tools.
- Separators inside quotes also split a command (conservative: more matches for deny, fewer for allow), and heredoc bodies are checked line by line.

## Network (proxy and CA)

```json
{ "version": 1, "network": { "proxy": "http://proxy.corp:3128", "noProxy": ["localhost", ".corp"], "caCertFiles": ["/etc/pista/corp-ca.pem"], "useSystemCa": true } }
```

- The standard variables `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` (upper or lower case) and `NODE_EXTRA_CA_CERTS` are honoured with or without a policy. The `network` block wins over them, except that environment `NO_PROXY` still applies when the policy sets only `proxy`. Loopback (`127.0.0.1`, `localhost`, `::1`) is always added to the no-proxy list, so local model servers are never sent through the proxy.
- The host installs one global HTTP dispatcher at the very start, so model providers, MCP servers over HTTP, and OIDC sign-in all go through the proxy. Libraries that read the proxy from the environment (the AWS SDK for Bedrock) get it from the same value.
- `caCertFiles` are PEM files read once at startup and added to the built-in trust store; `useSystemCa` also trusts the operating system store. An unreadable file stops the host. Requires Node 22.19+ (or 24.5+) for libraries that bypass `fetch`; on older Node only `fetch`-based traffic trusts them (the host logs a warning), and node:https clients such as Bedrock need `NODE_EXTRA_CA_CERTS` set by the launcher.
- The proxy URL may carry credentials. The host never logs them (userinfo is shown as `***`), but the policy file itself holds them, so keep it root-owned; prefer a proxy that authenticates by network location.
- The Electron browser pane uses the operating system's proxy settings and is not affected.

## Telemetry

```json
{ "version": 1, "telemetry": { "piTelemetry": false, "versionCheck": false } }
```

`piTelemetry: false` sets `PI_TELEMETRY=0` and `versionCheck: false` sets `PI_SKIP_VERSION_CHECK=1` before Pi loads. A key the policy does not mention keeps Pi's behaviour.

## Browser domains

```json
{ "version": 1, "browser": { "allowedDomains": ["example.com", "*.docs.example.org"], "deniedDomains": ["admin.example.com"] } }
```

Limits which sites the agent's `browser_*` tools may open. Admin-only (no user setting).

- Entries are an exact host (`example.com`, an IP such as `10.0.0.5` or `[::1]`) or `*.example.com`, which matches subdomains only, so list `example.com` too if you want both. No scheme, port, path or regex; an entry like that, a non-array, or an unknown key in the block stops the host (fail closed, like `network`).
- Deny wins over allow. When `allowedDomains` is set, every other host is denied.
- Once either list is set, only `http:` and `https:` URLs (plus `about:blank`) can be opened; `file:`, `data:`, `javascript:`, `blob:` and relative or scheme-less URLs are refused.
- Matching uses the parsed URL hostname, lower case, in punycode (IDN), with trailing dots removed. Credentials in the URL (`https://allowed.com@evil.com`) do not count, and decimal or hex IP forms are normalized by the URL parser (`http://2130706433` is `127.0.0.1`).
- Enforcement is in the tools: `browser_navigate` refuses a blocked URL before it loads, and every tool re-checks the page URL it ends on (redirects, clicks, Enter, history). A blocked page is replaced by `about:blank` and the tool returns a "Blocked by your organization's policy" error instead of any page content.

Limits, stated plainly:

- This governs the agent, not the person. The user can still browse by hand in the browser pane; the desktop pane has no navigation guard fed from the policy.
- Subresources, scripts the page loads and `fetch` calls from page scripts are not filtered, and a redirect chain is judged by where it ends, not by every hop. A page on an allowed host can embed or link to others. For network-level control use the proxy (`network.proxy`) and your firewall.
- A click that opens a new window or tab is not followed by the guard; the guard sees the tab the tools drive.
- A refusal is not a separate audit event; it shows as a failed tool call.
- Other tools (`web_search`, `fetch_content`, MCP servers, shell) are not covered; control them with `tools` rules.

- `allowedDomains: []` denies every site. With a denylist only, loopback (`localhost`, `127.0.0.1`, `[::1]`) stays open; list those in `deniedDomains` if you need them blocked.
- Before each page action the tools re-check the open page; an unreadable (empty) address is retried briefly and then treated as blocked.

A change needs a host restart (see [When changes take effect](#when-changes-take-effect)). `pista policy check` prints the normalized block and warns about patterns like `*.com` that cover a whole top-level domain.

## Updates

```json
{
  "version": 1,
  "updates": {
    "enabled": true,
    "channel": "stable",
    "feedUrl": "https://updates.example.com/pista",
    "minimumVersion": "1.2.0",
    "maximumVersion": "2.0.0",
    "enforcementHours": 72
  }
}
```

The block is admin-only (there is no user setting) and fail-closed like `network`: any invalid value or unknown key stops the host.

- `enabled`: boolean. `false` switches the desktop updater off.
- `channel`: `"stable"` (default) or `"beta"`. `-rc` and `-alpha` builds publish their own channel files but cannot be selected here.
- `feedUrl`: `https` URL of the update feed. `http` is accepted only for `localhost`, `127.0.0.1` and `[::1]` (testing). Credentials, a query string and a fragment are rejected, because the value is reported unauthenticated on the loopback `/health` endpoint.
- `minimumVersion`, `maximumVersion`: semver `MAJOR.MINOR.PATCH` with an optional `-prerelease` (`+build` is ignored). A leading `v` is rejected. The minimum must not exceed the maximum. A prerelease sorts below its release, so `1.2.0-beta.1` is below `1.2.0`.
- `enforcementHours`: integer from 1 to 720, hours between forced update checks.

Version gate: the host compares its own version (`PISTA_APP_VERSION` when valid semver, which the desktop shell sets; otherwise the host package version) with the range. Outside it, the host still starts but runs in blocked mode: it logs why, keeps serving the UI, `host.hello`, `/health` and settings reads, and refuses requests that start or run agent work (`thread.create`, `thread.prompt`, `thread.compact`, `thread.goal.set`, `thread.goal.resume`, `thread.bash`) with the error code `version_blocked`. `host.hello` and `/health` report `versionGate` and a non-secret `updates` summary. `pista policy check` prints the block and a `Version gate:` line.

`PISTA_DISABLE_AUTOUPDATER=1` in the environment disables the updater; it can only disable, never enable what the policy turned off.

Headless and server deployments have no updater. Update them through the container image or package manager; the version gate applies there too.

### Desktop updater

The packaged macOS app updates itself with `electron-updater` (pinned to 6.8.11), driven by the policy above.

- **Off when**: the app is not packaged (dev), the host runs headless (no Electron, no updater), the platform is not macOS (see [Limitations](#limitations)), the host cannot be reached for its `updates` summary (fail safe), `updates.enabled` is `false`, `PISTA_DISABLE_AUTOUPDATER=1` is set, or there is neither a `feedUrl` nor an `app-update.yml` in the app resources. Nothing is ever installed while it is off.
- **Feed**: with `feedUrl` set the updater uses that generic `https` feed. Without it, it uses the feed baked into the build (`app-update.yml`); that default feed is the repository's published GitHub releases (see Release feed below).
- **Channel**: `stable` uses the default channel; `beta` selects the `beta` channel. Downgrades are never allowed.
- **Restart prompt**: an update downloads in the background, then the user is asked to restart now or later. Later installs on quit. With `enforcementHours`, a "later" answer schedules a forced restart that many hours after the first download (a newer build does not postpone it): a dialog announces it, and Pista restarts after a 60 second countdown. When the version gate is blocking the app (below the minimum), the update is checked immediately and the forced restart is used without asking.
- **Checks**: shortly after start, then every 4 hours.
- **Signature**: macOS enforces the update signature through Squirrel.Mac, which needs a Developer ID signed (and notarized) app; an unsigned build cannot apply updates even from a `feedUrl`. `verifyUpdateCodeSignature` is never replaced and only `https` feeds are accepted (plain http only for loopback in tests).
- **Cache exception**: downloaded updates are cached by electron-updater in `~/Library/Caches/@pistadesktop-updater` (electron-builder writes `sanitizeFileName("@pista/desktop").toLowerCase() + "-updater"` into `app-update.yml`; sanitizing drops the `/`), which is desktop shell state outside `PISTA_HOME`. A build without `app-update.yml` (feedUrl only) falls back to `~/Library/Caches/Pista`. The host never writes there.
- **Proxy**: the updater downloads through Electron's network stack, so it follows the OS system proxy, PAC file and OS trust store (macOS keychain CAs). The `network` proxy and CA settings of the policy apply to the host only, not to updates. Configure the system proxy through MDM.
- **Not testable without Apple credentials**: the actual install (Squirrel.Mac signature check and relaunch). Policy handling, channel, scheduling and prompts are covered by unit tests.

### Release feed and company-hosted mirror

Each `v*` tag builds a **draft** GitHub release (`.github/workflows/release.yml`) with `Pista-<version>-arm64.dmg`, `Pista-<version>-arm64-mac.zip` (what Squirrel.Mac installs from), their `.blockmap` files and `latest-mac.yml`. The updater only sees **published** releases, so nothing reaches users until a human publishes the draft. A build made without signing secrets is listed as unsigned in the job summary and must not be published for auto-update.

Forks publish their own feed by setting `PISTA_UPDATE_OWNER` and `PISTA_UPDATE_REPO` (default `Pista-AI` / `pista`) when packaging; the values are baked into `app-update.yml`.

Channels: With the GitHub publish provider electron-builder 26 writes only `latest*.yml`, even for a prerelease version (measured with `0.0.0-rc.9`: `latest-mac.yml`). `apps/desktop/scripts/package.mjs` therefore also copies each `latest*.yml` to `<channel>*.yml` for a prerelease version, where the channel is the first prerelease identifier: `-beta.N` gives `beta-mac.yml`, `-rc.N` gives `rc-mac.yml`, `-alpha.N` gives `alpha-mac.yml` (Windows `beta.yml`, Linux `beta-linux.yml`, and so on). Stable versions write `latest*.yml` only. Only `stable` (`latest`) and `beta` can be selected through the managed policy; `rc` and `alpha` builds publish their own yml for testers who install that build by hand (an installed prerelease follows its own channel). Any tag with a `-` suffix becomes a GitHub prerelease. The release version is taken from the tag, not from `package.json`.

To serve updates from your own HTTPS server (`updates.feedUrl`), mirror the files of a published release into one flat directory:

```
node scripts/mirror-release.mjs v0.3.0 ./pista-feed     # needs the gh CLI, signed in
```

```
https://updates.example.com/pista/
  latest-mac.yml                  stable channel pointer
  beta-mac.yml                    beta channel pointer (only if you mirror a beta release; rc-mac.yml likewise)
  Pista-0.3.0-arm64-mac.zip       + .blockmap
  Pista-0.3.0-arm64.dmg           + .blockmap (first installs; the updater uses the zip)
```

Set `"feedUrl": "https://updates.example.com/pista"`. The updater requests `<feedUrl>/latest-mac.yml` (or `beta-mac.yml`) and the files it names, relative to the same directory. Upload the zip before the yml so a client never reads a pointer to a missing file. Mirror stable and beta releases into the same directory; each has its own yml. Mirrored files stay signed, so the server needs only static hosting.

## Audit

```json
{
  "version": 1,
  "audit": {
    "otlpEndpoint": "https://otel.corp.example:4318",
    "headersEnv": { "authorization": "PISTA_AUDIT_AUTH" },
    "includePrompts": false,
    "includeToolArgs": false,
    "resourceAttributes": { "deployment.environment": "prod" }
  }
}
```

- With no `audit` block nothing is sent. The block lives only in the managed policy; users cannot change it. A malformed block (unknown key, non-http(s) URL, URL with `user:pass@`, invalid header name) stops the host.
- OTLP/HTTP JSON only: records are POSTed to `<otlpEndpoint>/v1/logs` (a trailing `/v1/logs` is not doubled). `protocol` may be omitted or `"http"`; `"grpc"` is rejected.
- Export uses the same global dispatcher as everything else, so the `network` proxy and CA settings apply. Plain http to a non-loopback host with `headersEnv` set logs a warning.
- Header values are read from the named environment variables at startup; the file never holds a secret. A missing variable logs a warning and omits that header.
- Records are batched (50 or every 5 s, and at shutdown) with a 5 s timeout, at most 1000 queued. A failing collector never blocks the agent: records are dropped and counted, with one warning. Only the collector's origin is logged.

Resource attributes: `service.name=pista`, `service.version`, `host.name`, `os.type`, plus `resourceAttributes`. Every record carries `event.name`, and `enduser.id` (the OIDC subject) when signed in, plus `session.id` and, when known, `project.id`.

| Event | Attributes |
|---|---|
| `pista.session.start` | `cwd.hash`, `session.restored` |
| `pista.session.end` | `session.end.reason` (archived, project_removed, reloaded, shutdown), `session.message_count` |
| `pista.prompt` | `prompt.length`, `prompt.queued` (steering or queued prompts); body = prompt text only with `includePrompts` |
| `pista.tool.decision` | `tool.name`, `tool.kind` (builtin, shell, mcp, browser, internal), `decision` (allow, deny), `decision.source` (policy, approval, loop_guard, extension) and `decision.rule` (policy rule id; `gate.error` when a gate threw) on deny; `mcp.server`, `mcp.tool`; `browser.action`, `url.domain`; `shell.command_name`; body = JSON arguments only with `includeToolArgs` |
| `pista.tool.result` | `tool.name`, `tool.kind`, `success`, `duration.ms`, plus the classification attributes above |
| `pista.project.trust` | (only when the decision changes, and on the user's toggle) `trusted`, `trust.reason`, `trust.source` (user, default) |
| `pista.model.usage` | `gen_ai.request.model`, `gen_ai.provider.name`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens`, `cost`; `input_tokens` excludes cache tokens |

Every tool call yields exactly one decision, the final outcome (`extension` means a user or project extension blocked it before Pista's own gates). Without the opt-ins no prompt text, arguments, paths, full URLs or command lines are recorded (only the executable name and URL host). Even with them, bodies are truncated to 4 KB and redacted: values under keys matching `token|secret|password|authorization|api[ _-]?key|cookie`, text such as `Bearer x` or `token=x` inside any string (command lines included), the values (8+ characters) of environment variables with such names, and the values behind `headersEnv` are replaced by `[redacted]`.

`project.id` and `cwd.hash` are unsalted hashes of the project path: they correlate events but can be reversed by guessing paths.

## Retention

An admin-locked `retention` block deletes old local data. Without the block nothing is ever deleted automatically.

```json
{ "version": 1, "retention": { "sessionDays": 90, "traceDays": 14, "purgeOnStartup": true } }
```

- `sessionDays` (1 to 3650): threads idle for longer than this are deleted, with their session files.
- `traceDays` (1 to 3650): browser trace files (`$PISTA_HOME/browser-traces/*.jsonl`) older than this are deleted.
- `purgeOnStartup` (default `true`): `false` skips the run at startup. The purge also runs every 4 hours while the host is up.
- Unknown keys, non-integers and out-of-range values stop the host (see [Fail closed](#fail-closed)).

What the purge does: it removes a thread the same way a user's delete does (so the thread list updates live), then deletes its session file. A thread that is open, running or has a running goal, or whose sub-agent threads are, is kept. Only regular files that really lie under `PISTA_HOME` (or Pi's agent dir) are deleted: symlinks are never followed or removed. The host logs counts only and emits a `pista.retention.purge` audit event with the counts.

What it does not delete: the LLM gateway's and the model provider's own retention, MCP servers' data, audit data already exported, pi-memory notes, `PLAN.md` files written into projects, traces written to a `PI_BROWSER_TRACE_DIR` outside `PISTA_HOME`, and Pi session files of projects Pista no longer lists. Deleted files are unlinked, not securely wiped.

Details: only `.jsonl` files under Pi's `sessions` folder (session files) and `$PISTA_HOME/browser-traces` (traces) are ever deleted, so `config.json`, `auth.json` and the like are out of reach. Files that fail a safety check are skipped and counted in the log. The path check and the unlink are two steps, so someone who can already write to `PISTA_HOME` could swap a file in between; that is not a privilege gain.

## Fail closed

The host exits with an error instead of running unrestricted when:

- the policy exists but is unreadable, is not valid JSON, or lacks `version: 1`;
- an MDM source exists but cannot be used (see Delivery through MDM);
- a **strict block** is malformed. The strict blocks are `network`, `telemetry`, `browser`, `updates`, `audit`, `retention` and `policySource`. In them an unknown key, a wrong type or an out-of-range value counts as malformed, so a policy that uses a newer key there stops an older host;
- an unreadable CA file is named in `network.caCertFiles`, or `PISTA_POLICY_URL` / `PISTA_POLICY_PUBLIC_KEY` are invalid.

Set `PISTA_REQUIRE_POLICY=1` in the environment the host starts in (MDM, launcher, container) and the host also refuses to start when no policy is found at `PISTA_POLICY_FILE`, MDM or the platform path, or when the remote policy cannot be fetched and no cached bundle verifies (see Policy from a URL).

Everything else only warns and the rest of the policy applies: unknown top-level keys, unknown or mistyped `locked` / `defaults` settings, and a bad gateway, MCP server or package entry. `providers`, `models`, `mcp`, `extensions` and `tools` keep their own rules, described in their sections. Notably `tools` fails closed on a malformed section, by denying rather than by stopping the host.

## When changes take effect

The host reads the policy once, while it starts, and keeps it in memory. Nothing is hot-applied: editing the file, changing the MDM value or publishing a new remote bundle changes nothing for a running host. A remote refresh (every `refreshMinutes`) only logs `restart Pista to apply it`. Restart the host (the desktop app, or the server process) to apply a change.

After the restart, each block takes hold as follows:

| Block | Takes hold |
|---|---|
| `locked`, `defaults` | At startup. `defaults` are written to `config.json` then; `locked` values are overlaid and never saved. |
| `providers`, `models` (gateways, allowlists, direct login) | At startup: gateways are registered and allowlists checked from then on. |
| `mcp` | At startup, when the host reconciles `$PISTA_HOME/pi/mcp.json`. |
| `extensions` | Packages are written to Pi's `settings.json` each time a session is built, so threads started after the restart get them. |
| `tools` | Compiled at startup, checked on every tool call from then on. |
| `network`, `telemetry` | At startup, before Pi loads. |
| `browser` | At startup. The rules apply to every browser action after the restart. |
| `updates` | At startup: the version gate and the updater summary are computed once. The desktop updater reads the summary when the app starts. |
| `audit` | At startup: the exporter is created then. |
| `retention` | At startup: the first purge runs then (unless `purgeOnStartup` is `false`), and then every 4 hours. |
| `policySource` | At startup: the fetch happens during boot. |

Environment variables the policy refers to (`apiKeyEnv`, `headersEnv`, `${ENV}` references) are also read at startup.

## Checking a rollout

`policy check` loads the policy exactly as the host does at startup, reports whether the host would start, and exits without starting anything. Run it on a machine after the policy is deployed, or in CI before you ship it.

```sh
# From a checkout
pnpm policy:check [--json]
# Headless build
node apps/host/dist/host.mjs policy check [--json]
# Packaged macOS app
ELECTRON_RUN_AS_NODE=1 /Applications/Pista.app/Contents/MacOS/Pista /Applications/Pista.app/Contents/Resources/host/dist/host.mjs policy check
```

It honours `PISTA_POLICY_FILE` and `PISTA_REQUIRE_POLICY` like the host. The first line names the source (`env-file`, `mdm`, `file`, `url` or `none`); `--json` has the same value as `sourceKind`. It then prints the locked and default settings, a `Version gate:` line, and each other block as normalized JSON. When a remote policy source is configured, `check` does a live fetch (nothing is written to the cache) and ends with a `Remote policy:` line. Example output:

```text
Policy source: file — /etc/pista/managed-policy.json
Status: ok (exit 0)

Locked:
  approvalMode = "read-only"

Defaults:
  webSearchEnabled = false

network: {"proxy":"http://***@proxy.example.com:8080"}
```

| Exit code | Meaning |
|---|---|
| 0 | Policy is valid and fully applied. |
| 1 | Fatal: the host would refuse to start (unreadable or invalid file, unreadable CA file, or `PISTA_REQUIRE_POLICY=1` with no file). |
| 2 | Warnings only: the host starts, but something was ignored (for example an unknown key). |
| 64 | Unknown `policy` subcommand or flag (`pista policy sign` also uses 64 for bad usage). |

`--json` prints the same result as JSON with these fields: `status` (`ok`, `warnings` or `fatal`), `exitCode`, `source`, `sourceKind`, `fatal`, `warnings`, `effective` (the policy with secrets masked, or `null` when none is in force), `appVersion` (the version the host would run as), `versionGate` (what the `updates` range makes of `appVersion`) and, when a remote source is configured, `remote` (`url`, then `origin` (`fetched` or `cache`), `serial` and `cacheAgeMinutes` on success, or `error`). The output is safe to paste into a ticket: values under `headers` and `env`, keys that look like secrets (`token`, `secret`, `password`, `apiKey`) and credentials in URLs are masked. Names of environment variables (`apiKeyEnv`) are shown.

Settings in the app shows where each value comes from: a "Managed" badge for locked values (hover for the policy file path) and an "Org default" badge for values set by `defaults`.

## Deployment

### macOS

The desktop app is `Pista.app`, from the dmg that the release workflow builds (see [release-signing.md](release-signing.md) for signing and notarization). The app starts its own host, which reads the policy from the sources described in [Where the policy lives](#where-the-policy-lives):

- the file `/Library/Application Support/Pista/managed-policy.json`, administrator-writable only; or
- a Configuration Profile, using the template in [`enterprise/pista.mobileconfig`](enterprise/pista.mobileconfig).

Set `PISTA_REQUIRE_POLICY=1` in the launcher environment if the app must not run without a policy. Run [`pista policy check`](#checking-a-rollout) on a machine after deploying.

### Windows

Installers come from the release workflow (artifact `pista-windows-x64`): an NSIS `Pista-Setup-<version>-x64.exe`. It can install per machine.

- Silent install (NSIS): `Pista-Setup-<version>-x64.exe /S /allusers` (installs to `%ProgramFiles%\Pista`; add `/D=C:\Path` last to change the folder). Uninstall: `"%ProgramFiles%\Pista\Uninstall Pista.exe" /S /allusers`.
- MSI is not built (it needs an application icon, see the comment in `electron-builder.config.cjs`). For Intune use a Win32 app with the NSIS command above; for GPO use a startup script running it.
- Policy: deploy `%ProgramData%\Pista\managed-policy.json` (administrator-writable only) or set `PolicyJSON` / `PolicyJSONBase64` under `HKLM\SOFTWARE\Policies\Pista` through an ADMX-less registry policy or Intune custom settings. See [Where the policy lives](#where-the-policy-lives).
- Per-user state stays under `%USERPROFILE%\.pista`.
- Unsigned builds trigger SmartScreen; sign the installers (see [release-signing.md](release-signing.md)) before a wide rollout.
- The release carries `latest.yml` and the blockmap for Windows, but there is no in-app updater on Windows yet (see [Limitations](#limitations)); roll out new versions by redeploying the installer.

### Web and headless

Web deployments run one host per user. Mount the policy file at the platform path inside the container, or point `PISTA_POLICY_FILE` at it. There is no updater; update through the container image or package manager (the version gate still applies).

## Limitations

Gaps that are still true. Enforcement limits specific to one area (tool rules, MCP servers, extensions, browser domains) are stated in that section.

**Platforms and release**

- There are no in-app updates on Windows and Linux: the updater is macOS only (`updater-core.ts` turns it off elsewhere). Redeploy the installer or package.
- The Windows and Linux packages are built in CI only. First launch, the host spawn and the bundled llama.cpp download have not been tested on real hardware. MSI is not built.
- MDM delivery (macOS managed preferences, Windows HKLM) is covered by unit tests; it has not been tried on real managed machines.
- The update install (Squirrel.Mac signature check and relaunch), notarization and the Windows signing paths are unverified without real credentials (see [release-signing.md](release-signing.md)).
- The updater downloads through the OS network stack, so `network` proxy and CA settings do not apply to updates, and they do not apply to the Electron browser pane either.

**Sign-in**

- OIDC uses the device authorization grant only. Authorization code with PKCE and a loopback redirect is not implemented.
- The host does not verify the ID token signature; the gateway validates the bearer.

**Browser domains**

- The rules govern the agent's `browser_*` tools, not the person: manual browsing in the pane is unrestricted, because the desktop pane has no navigation guard fed from the policy.
- Subresources, page scripts and `fetch` calls are not filtered, and a redirect chain is judged by where it ends.
- A click that opens a new window or tab is not followed by the guard.
- Other tools (`web_search`, `fetch_content`, MCP servers, shell) are not covered; use `tools` rules and the proxy.

**Retention**

- Traces written to a `PI_BROWSER_TRACE_DIR` outside `PISTA_HOME` are not covered, nor are the other items listed under [Retention](#retention) (gateway and provider retention, MCP data, exported audit data, pi-memory notes, `PLAN.md` files, Pi session files of unlisted projects). Deleted files are not securely wiped.

**Policy from a URL**

- The cache is writable by the user, so deleting it removes the rollback floor, and a cached bundle has no maximum age.

**Behaviour**

- Nothing hot-applies (see [When changes take effect](#when-changes-take-effect)).
- Tool-rule shell patterns are best effort; the real boundary is an OS sandbox or a container (see [Tool rules](#tool-rules)).
