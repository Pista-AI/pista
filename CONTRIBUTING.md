# Contributing

Thanks for helping with Pista. Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before taking part.

## Setup

Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm dev          # host on 127.0.0.1:4317, UI on http://localhost:5317
pnpm typecheck    # all packages
pnpm test         # all packages
```

See [README.md](README.md) for the desktop app and headless mode, and [AGENTS.md](AGENTS.md) for the project layout and conventions.

## Pull requests

- Keep them small and focused: one concern per PR, ideally a few hundred changed lines at most.
- Keep refactors and renames separate from behaviour changes.
- `pnpm typecheck` and `pnpm test` must pass.
- Mention any new dependency in the PR description. Do not edit `pnpm-lock.yaml` by hand.

## Server-readiness rules

Pista must also run as a headless server (`pnpm build && pnpm start`, no Electron).

- The host never assumes Electron; desktop-only code goes behind `DesktopBrowserBridge` / `window.pistaDesktop` or a driver interface.
- All per-user state lives under `PISTA_HOME`.
- Secrets come from environment variables, never from files in the repo or hard-coded values.
- The host binds loopback only and adds no new listeners.
- The browser driver is chosen by configuration (`PISTA_BROWSER_DRIVER`).

## Security rules

- The host binds 127.0.0.1 and accepts WebSocket upgrades only from known origins.
- Consequential browser actions and password fields hand control back to the user.
- Downloads of local runtimes are opt-in and hash-verified.

To report a vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

By contributing you agree that your contributions are licensed under Apache-2.0.
