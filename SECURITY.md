# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately using GitHub's "Report a vulnerability" button on the
repository's Security tab (private vulnerability reporting). Do not open a public issue for a
security problem. We will acknowledge the report and work with you on a fix and disclosure.

## Supported versions

Only the latest release receives security fixes.

## Security model

### Desktop shell

- Electron fuses disable running as Node, `NODE_OPTIONS` and inspect arguments; cookie encryption, ASAR integrity and loading only from the ASAR are on.
- Packaged builds refuse remote-debugging and inspect flags, and DevTools is unavailable.
- The optional `chrome` browser engine (`PISTA_BROWSER_DRIVER=chrome`) is different: it starts a separate Chrome, Edge or Brave process with a dedicated profile under the Pista home (never your own profile) and talks to it over a private pipe (`--remote-debugging-pipe`, inherited file descriptors). No TCP port is opened, so no other local process can attach to it. Managed domain rules are also enforced inside that browser: every document load in the agent's own tab, in popups and in frames is checked, redirects included, and a page that cannot be guarded is closed. Subresource requests (fetch, XHR, WebSocket, images) to denied hosts are not blocked, the same as in the embedded pane. Downloads are refused except the ones `browser_download` asks for; they land in the confined project folder, are limited to 200 MB, and a download by address checks every redirect hop against the rules. One browser and one tab serve all threads, and the rules of the first thread that used it apply.
- The renderer sandbox is enabled and the UI window has a strict content security policy.

### Host and browser pane

- The host runs as an Electron utility process, binds to loopback (127.0.0.1) only and accepts WebSocket upgrades only from known origins.
- Browser pane permission requests (camera, microphone, geolocation, USB, HID, serial and similar) are denied, and the pane only loads http and https.
- Downloads are confined to the project folder by a path policy (no hidden directories, executables, scripts or symlinks; sealed directories such as `~/.ssh` and the Pista home are refused) and re-checked at write time.
- Consequential browser actions and password fields hand control back to the user.
- `browser_eval` and `browser_screenshot` redact password and other secret field values (a password field stays secret after a show-password toggle): `browser_eval` replaces literal values of 6+ characters in its result or error with `[redacted]`, and screenshots draw those fields as dots. Transformed values (encoded, reversed, split across pieces), fields in cross-origin frames and fields the script creates itself are not caught. Strict deployments should deny the tool with `tools.deny: ["browser_eval"]` in the managed policy (see `docs/ENTERPRISE.md`, Tool rules).
- The host reaches outside only through configured MCP servers, model providers and the browser driver.
- Secrets and tokens come from environment variables (`${ENV_VAR}` references in `mcp.json`), not from files in the repo.
- Per-user state lives under `PISTA_HOME`.
- Local runtime downloads (llama.cpp) are opt-in and hash-verified.

### Saved logins

- Website logins are stored encrypted with Electron safeStorage (OS keychain, DPAPI or libsecret); a plain-text fallback is refused.
- The desktop process fills them bound to the exact origin; the model never reads them and `browser_login` returns only ok and a note.
- Each sign-in asks for approval, and Touch ID confirms presence before the first fill where available.
- The detailed threat model is in [docs/security/saved-logins.md](docs/security/saved-logins.md).

### Provider credentials

- Pi provider credentials live in an AES-256-GCM `auth.enc.json` under `$PISTA_HOME/pi`.
- MCP OAuth tokens live in `mcp-auth.enc.json` next to it, with the same key and file handling; a plain `mcp-auth.json` is migrated and removed. The host refuses to start if Pi no longer exposes the token store class it hooks into.
- The desktop generates the key, wraps it with safeStorage and hands it to the host over the utility-process message channel, never through argv, env or logs.
- Headless use needs an explicit key or `PISTA_AUTH_PLAIN=1`.

### Known gaps

- Windows has no app-bound-encryption equivalent, so other processes of the same user can call DPAPI.
- Unsigned builds weaken the macOS Keychain access control.
- There is no cross-process lock for two hosts sharing one `PISTA_HOME`.
