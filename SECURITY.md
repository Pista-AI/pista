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
- `browser_eval` and `browser_screenshot` keep password and other secret field values (a password field stays secret after a show-password toggle) out of what the model receives: `browser_eval` replaces literal values of 6+ characters in its result or error with `[redacted]`, and screenshots draw those fields as dots. That scrubbing stops accidental exposure; a deliberately adversarial script (for example one planted by a prompt-injected page) can transform a value or plant code that copies it into page text. The harness therefore keeps scripts away from places where a password can be, with no setting and nothing the agent decides:
  - `browser_eval` is refused on any site with a saved login: the dedicated Chrome profile's password manager (only the address columns of a copy of its database are read, never usernames or passwords; if it cannot be read, the tool stays off) and, where the driver has one, Pista's own saved logins. Sites are matched by registrable site (scheme and port ignored), so `accounts.example.com` matches a saved `example.com`.
  - Before every `browser_eval`, and after browser tool calls, the page is checked for password fields in every frame it can reach, in a separate JavaScript world that page code cannot patch (embedded pane: a plain page check, which a patched page could in theory fool). Once one is seen, `browser_eval` stays off on that origin until the app restarts.
  - A script starts only in the document that was checked (the gate writes a one-time token onto it, and the script looks for it first): if the page navigates (a redirect) before it starts, it does not run and the result is dropped.
  - A document a script ran in is reloaded, with the tool's result discarded, if a password field appears in it later, and it is always reloaded before the browser is handed to the user (`browser_show_user`), at the cost of any form state typed there earlier.
  - Browser-internal pages (`chrome://`, `chrome-extension://`, `devtools://` and similar) and `javascript:` addresses cannot be opened or used by the agent.
  - Detection covers password fields (including open shadow roots) in the frames the browser lets the harness reach. It does not see password fields in closed shadow roots, nor plain text fields with no password hint.
  - Embedded pane: the reload rule and the isolated-world check do not apply yet. There, only a main-world check runs before `browser_eval` and on handoff, which a deliberately patched page could in theory fool.
  - Remaining limit: a script run on a site with no saved login and no password field yet can still plant code that captures a password the user types by hand outside a handoff, in the same document. Sending data to a third-party server is outside this guard and is governed by the domain policy.
- **Where credentials can be entered.** Pista never types passwords: the browser typing tools refuse password fields, and the model never holds a password. In the Chrome engine only Chrome's own password manager fills saved logins, using Chrome's site matching. In the embedded pane the saved-logins vault (`browser_login`) fills only on the exact saved origin: the top-frame origin is checked before each step and again right before the password is typed, and a navigation to another origin stops the fill. After the password is submitted the page may redirect (single sign-on), and nothing more is typed. The first fill after launch (and after the unlock expires or the machine wakes) needs an operating-system presence check such as Touch ID.
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
