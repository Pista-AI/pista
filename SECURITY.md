# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately using GitHub's "Report a vulnerability" button on the
repository's Security tab (private vulnerability reporting). Do not open a public issue for a
security problem. We will acknowledge the report and work with you on a fix and disclosure.

## Security model

- The host binds to loopback (127.0.0.1) only and accepts WebSocket upgrades only from known origins.
- Secrets and tokens come from environment variables (`${ENV_VAR}` references in `mcp.json`), not from files in the repo.
- Per-user state lives under `PISTA_HOME`.
- Consequential browser actions and password fields hand control back to the user.
- Local runtime downloads (llama.cpp) are opt-in and hash-verified.
- The host reaches outside only through configured MCP servers, model providers and the browser driver.
