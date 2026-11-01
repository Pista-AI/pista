# Harnesses

A harness is a procedure the host enforces in code. Instead of asking the model to follow a workflow in the prompt, a harness adds a prompt section, tools and a Pi extension whose hooks gate, steer and drive the run (for example, blocking edits until a plan exists). The default harness is `solo`: it adds nothing, and the agent works as a single loop.

Pista ships one other harness, `sliced`. The model first splits a code-changing request into independently verifiable slices, each with a command or behaviour that proves it. The host then runs each slice in a child agent (in dependency order, a few at a time) and finishes with an integration pass. Requests that fit one agent, or have too few slices, run solo.

A harness applies to top-level threads only. Child agents never get one.

## Selecting a harness

Two keys in `config.json` (also settable in managed policy `defaults` and `locked`):

- `harness`: the harness id. Absent means `solo`, unless a legacy key applies.
- `harnessConfig`: settings per harness, keyed by id, for example `{ "sliced": { "minSlices": 4 } }`. The harness reads its own block on every call, so changes apply without rebuilding the thread's extension. The block is opaque to the host; the harness's `validateConfig` checks it where policy validates settings.

Legacy aliases, kept for existing configs:

- `orchestratorMode: "sliced"` selects `sliced`.
- `sliced` is read as `harnessConfig.sliced` when that is absent.

Precedence: `harness` beats `orchestratorMode`. A non-solo harness replaces whatever orchestrator mode is set. `harness: "solo"` only switches off the legacy `sliced` alias; the other orchestrator modes (`delegate`, `delegate-read`, `lead`) are prompt and tool restrictions, not harnesses, and still apply. An unknown id, or one the policy refuses, logs a warning once and the thread runs without a harness (its orchestrator mode, if any, still applies).

## What a harness contributes

A harness is an object with an `id` and optional parts. Every part may be left out. `eval` is only used by the preset eval (`metrics(entries)` derives per-run metrics from a kept session's entries; the optional `column` adds a report column, with a `header` and a `cell(runs)` that renders one preset's runs). The host does not need it to run a thread.

```ts
interface Harness {
  id: string;                                         // /^[a-z][a-z0-9-]{0,63}$/
  prompt?(host: HarnessContext): string | undefined;  // appended to the system prompt
  tools?(host: HarnessContext): string[] | undefined; // tool allowlist for the thread; undefined = no restriction
  extension?(host: HarnessHost): InlineExtension;     // a Pi extension, built per thread
  validateConfig?(raw: unknown): boolean;             // checks harnessConfig[id]
  entries?: string[];                                 // custom session entry kinds it persists
  eval?: HarnessEval;                                 // { metrics(entries), column?: { header, cell(runs) } }
}
```

`tools()` is an allowlist for the thread's tools; when it returns nothing, the legacy orchestrator tool list (if any) applies. `defineHarness(h)` is an identity helper for typing. The types are in `apps/host/src/harness/types.ts`.

The host object a harness receives:

| Member | Meaning |
|---|---|
| `cwd` | The thread's working directory. |
| `config<T>()` | The harness's own settings block (`harnessConfig[id]`), read on each call. |
| `windowCap()` | `contextWindowCap`: the window the thread is held to, whatever the model advertises. |
| `readOnlyTools` | Names of the read-only tools, for phases that must not write. |
| `state.read<T>(kind)` | The latest custom session entry of `kind`, or undefined. Use it to restore state on resume. |
| `runAgent` | Runs one child agent. Shared with the `agent` tool, so both count against the same child limit. Only in `extension(host)`; `prompt` and `tools` get a `HarnessContext`, which is the host without `runAgent`. |

The extension is a Pi inline extension: `{ name, factory(pi) }` (a bare `(pi) => ...` factory is also accepted). In `factory`, use Pi's extension API: `pi.registerTool`, the event hooks, `pi.appendEntry(kind, data)` to persist state (declare the kinds in `entries`) and `pi.sendMessage` to steer the model. The built-in `sliced` harness in `apps/host/src/harness/sliced/` is the full example. A minimal one is in [`examples/harness-demo`](../examples/harness-demo).

## Shipping a harness as a Pi package

A harness from outside the repo is a Pi package that declares it in `package.json`:

```json
{
  "name": "acme-harness",
  "type": "module",
  "pista": { "harness": { "id": "acme", "entry": "./dist/harness.js" } }
}
```

- `entry` is an ES module inside the package. Its default export is a `Harness`, or a function returning one. The module's `id` must equal the manifest's.
- The id must match `^[a-z][a-z0-9-]{0,63}$` (lowercase letters, digits and hyphens, starting with a letter) and must not be a built-in id (`solo`, `sliced`); a built-in cannot be replaced. The first package to register an id wins.
- `entry` must be relative and resolve, after following symlinks, to a file inside the package. Otherwise the package is skipped.
- Hooks (`prompt`, `tools`, `extension`, `validateConfig`) must be functions and `entries` an array of strings, or the harness is rejected.

Install it as any Pi package, in user scope: `pi install <source>` (an `npm:name@version`, a git source or a local path), or list it under `extensions.packages` in managed policy. Only user-scope packages are searched; a package declared in a project's `.pi/settings.json` is not.

When it is loaded. The host looks for a package harness when a top-level thread is built and the configured id is not built in or already registered. It scans the configured and managed package sources for a manifest declaring that id, runs the policy gate, then imports the entry. Loading runs package code inside the host process. A package that Pi has not installed yet (the very first thread after adding it) is not found, so that thread runs solo; the next thread finds it. A miss is cached, and the cache (and the warn-once record) is cleared after each session build and when the config changes, so the next thread retries. A registered harness stays until the host restarts; removing the package does not unregister it, though the policy gate still runs on every thread.

Failure. A missing package, a bad manifest, an import error, an invalid export or a denial logs one `[pista-host] harness package ...` warning and the thread runs solo. It never stops the host.

## Policy

Package harnesses run third-party code in the host, so the managed policy (see [ENTERPRISE.md](ENTERPRISE.md)) treats them strictly. The `harnesses` section:

```json
{
  "version": 1,
  "extensions": { "packages": ["npm:@acme/harness@1.0.0"] },
  "harnesses": { "allow": ["sliced", "acme"], "allowUserHarnesses": false },
  "locked": ["harness"],
  "defaults": { "harness": "acme" }
}
```

- `allow`: harness ids that may run. Absent allows every built-in. An empty list denies every non-solo harness. `solo` is always allowed.
- `allowUserHarnesses: false`: a harness runs only when the locked `harness` setting selects it, so a user cannot pick a different one. Default true.
- With no policy loaded, everything is allowed. With any policy loaded, a package harness needs both its id in `allow` and its package in `extensions.packages` (the managed list), even when `harnesses` is absent; a package the user installed themselves is refused, even if its id is listed.
- The gate runs before any package code is imported, and again on every thread build. It fails closed: a denial means no harness.
- A denial of an already registered harness is audited as `pista.harness.decision` with `harness.id`, `decision: "deny"`, `decision.rule` (`harnesses.allow`, `harnesses.packageNotManaged` or `harnesses.allowUserHarnesses`) and `decision.source: "policy"`. A denial at package-load time only logs a warning. A bad `allow` entry is dropped with a warning; a malformed (non-array) `allow` is treated as empty, which denies everything except `solo`.
- `harnessConfig` blocks set by policy must be objects; the `sliced` block is also checked by its validator. Blocks for other ids are accepted as is.

## Limitations

- One harness per thread, chosen by the host config. Harnesses do not compose.
- Top-level threads only; child agents run with their role and no harness.
- The `delegate`, `delegate-read` and `lead` orchestrator modes are not harnesses yet and still use `orchestratorMode`.
- Package harnesses are looked up in user-scope Pi settings only.
- A harness registered from a package stays until the host restarts.
- The first thread after installing a package runs solo.
- Policy `harnessConfig` validation uses a static map that only knows `sliced`. A package's `validateConfig` is not consulted there.
