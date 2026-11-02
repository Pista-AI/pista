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
- The renderer sandbox is enabled and the UI window has a strict content security policy.

### Host and browser pane

- The host runs as an Electron utility process, binds to loopback (127.0.0.1) only and accepts WebSocket upgrades only from known origins.
- Browser pane permission requests (camera, microphone, geolocation, USB, HID, serial and similar) are denied, and the pane only loads http and https.
- Downloads are confined to the project folder by a path policy (no hidden directories, executables, scripts or symlinks; sealed directories such as `~/.ssh` and the Pista home are refused) and re-checked at write time.
- Consequential browser actions and password fields hand control back to the user.
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
