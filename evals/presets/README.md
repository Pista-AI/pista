# Preset eval

Compares harness presets (HostConfig fragments) on a fixed set of tiny coding tasks and reports pass rate, mean cost, mean tokens and mean time per preset. The runner lives in `apps/host/src/eval/`; it drives a real `ThreadManager` in-process (no Electron), so the host's gates apply.

## Run

```
# No API calls: a scripted fake model writes each task's `fake/` solution.
pnpm eval:presets --fake --presets solo,routed --tasks '*' --runs 1

# Real (paid) run. --max-usd and --model are required.
pnpm eval:presets --presets solo,routed --tasks 'fix-*' --runs 3 --max-usd 2 --model anthropic/claude-sonnet-4-5
```

Options: `--presets a,b`, `--tasks name,name|prefix*|*`, `--runs N`, `--max-usd X`, `--model provider/id`, `--run-timeout SEC`, `--fake`, `--out DIR` (default `evals/presets/results/<timestamp>/`, git-ignored). Output: `report.json` (every run plus summary) and `report.md` (the table). Node >= 22.18 is needed to run the `.ts` fixtures.

## Cost cap

Cost is the sum of Pi's per-message `usage.cost.total` over the parent thread and its sub-agent threads (also counted when a run errors or times out); nothing is priced by Pista. Before each run the runner checks the cumulative cost and, once it exceeds `--max-usd`, skips every remaining run, records `aborted` in the report and exits 1. A single run is not interrupted by the cap, so the total can overshoot by up to one run. If the provider reports no cost the figure is 0 and the cap cannot trip, so keep `--runs` and the task count small there. `--run-timeout SEC` (default 600) aborts one run, records error `timeout` and moves on. `--runs`, `--max-usd` and `--run-timeout` must be positive numbers; `--model` is checked against the model registry before anything runs. The CLI exits 1 when the run was aborted or every run errored.

## Isolation and safety

Full-access approval is not a sandbox. The agent runs with your OS user's permissions and can read or write anything that user can, including this repo; the eval only keeps the agent's workspace and Pista's own state away from your real ones.

- Every run is its own process with a fresh `PISTA_HOME`, Pi agent dir (`PI_CODING_AGENT_DIR`) and memory dir (`PI_MEMORY_DIR`), all under a scratch temp dir that is deleted at the end (also in `--fake` mode). Your settings, `mcp.json`, sessions, memory and projects are never loaded.
- Real runs copy only `auth.json` and `models-store.json` from your Pi agent dir (`PI_CODING_AGENT_DIR`, else `$PISTA_HOME/pi`, else `~/.pista/pi`) into the scratch agent dir. The originals are never opened for writing; token refreshes land in the copy.
- The workspace is a copy of the task's `fixture/`, trusted and set to full-access for that folder only. Fixtures, hidden check files and the fake solution are first staged in the scratch dir, so the workspace and prompt never mention repo paths. They are still readable by absolute path (the staging dir sits next to the workspace), so a determined agent could find the hidden checks; this eval measures cooperative runs, not adversarial ones.
- Use real runs only on a machine where a full-access agent is acceptable.

## Add a task

`tasks/<name>/` with:
- `fixture/` the starting repo (node built-ins only, e.g. `node:test`; no install step).
- `task.md` the prompt.
- `task.json` `{ "check": "<command>" }`, run in the workspace after the agent finishes; exit 0 passes.
- `check.*` hidden test files, copied into the workspace only after the agent finishes.
- `fake/` files the `--fake` model writes (the reference solution).

## Add a preset

`presets/<name>/preset.json`: `{ "description": "...", "config": { ... }, "verify": { ... } }`. `config` is merged into HostConfig as-is (`agentOverrides`, `modelTiers`, `agentRoles`, ...; unknown keys are not validated here). `verify` is written to `<workspace>/.pista/verify.json`. An optional `presets/<name>/agents/*.md` is copied to `<workspace>/.pista/agents/`. Every run starts from fresh state, so nothing leaks between runs. The baseline `solo` sets nothing.
