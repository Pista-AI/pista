# harness-demo

A minimal [Pista harness](../../docs/harness.md) shipped as a Pi package. It adds one prompt section and one tool (`demo_hello`). It has no dependencies (its tool schema is a plain JSON Schema object; use `typebox`'s `Type.Object` instead if you want typed arguments, and declare `typebox` as a peer dependency) and is not part of the pnpm workspace (`pnpm-workspace.yaml` lists only `apps/*` and `packages/*`).

## Install

Pista reads the packages from Pi's user settings, so install it the way you would any Pi package, with a local path source:

```
PI_CODING_AGENT_DIR="$PISTA_HOME/pi" pi install /absolute/path/to/examples/harness-demo
```

Or add the path to `packages` in `$PISTA_HOME/pi/settings.json` by hand:

```json
{ "packages": ["/absolute/path/to/examples/harness-demo"] }
```

Under a managed policy, list the same source in `extensions.packages` and allow the id (see "Policy" in the harness docs):

```json
{ "version": 1, "extensions": { "packages": ["/absolute/path/to/examples/harness-demo"] }, "harnesses": { "allow": ["demo"] } }
```

## Select

In `$PISTA_HOME/config.json`:

```json
{ "harness": "demo", "harnessConfig": { "demo": { "greeting": "Howdy" } } }
```

Start a new thread. The first thread after installing runs solo, because the package is loaded while that thread is being built; the next thread uses `demo`. Ask "who are you?" and the agent should call `demo_hello`. If the harness does not load, the host log has a `[pista-host] harness package ...` warning and the thread runs solo.
