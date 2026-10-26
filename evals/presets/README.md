# Preset eval

Compares harness presets (HostConfig fragments) on a fixed set of tiny coding tasks and reports pass rate, mean cost, mean tokens and mean time per preset. The runner lives in `apps/host/src/eval/`; it drives a real `ThreadManager` in-process (no Electron), so the host's gates apply.

## Run

```
# No API calls: a scripted fake model writes each task's `fake/` solution.
pnpm eval:presets --fake --presets solo,routed --tasks '*' --runs 1

# Real (paid) run. --max-usd and --model are required.
pnpm eval:presets --presets solo,routed --tasks 'fix-*' --runs 3 --max-usd 2 --model anthropic/claude-sonnet-4-5
```

Options: `--presets a,b`, `--tasks name,name|prefix*|*`, `--runs N`, `--max-usd X`, `--model provider/id`, `--fake`, `--out DIR` (default `evals/presets/results/<timestamp>/`, git-ignored). Output: `report.json` (every run plus summary) and `report.md` (the table). Node >= 22.18 is needed to run the `.ts` fixtures.

## Cost cap

Cost is the sum of Pi's per-message `usage.cost.total` over the parent thread and its sub-agent threads; nothing is priced by Pista. Before each run the runner checks the cumulative cost and, once it exceeds `--max-usd`, skips every remaining run and records `aborted` in the report. A single run is not interrupted, so the total can overshoot by up to one run. If the provider reports no cost the figure is 0 and the cap cannot trip, so keep `--runs` and the task count small on such providers.

## Safety

Each run copies the task's `fixture/` to a fresh temp dir, trusts that dir only, and uses approval mode `full-access` (needed so the agent can edit and run without prompts) with that dir as the workspace. `PISTA_HOME` is a throwaway temp dir, so no real project, thread or setting is read or written. Real runs reuse your Pi credentials (`PI_CODING_AGENT_DIR`); `--fake` uses an empty one. Temp dirs are deleted afterwards. A full-access agent can still run any shell command, so use real runs only on a machine where that is acceptable.

## Add a task

`tasks/<name>/` with:
- `fixture/` the starting repo (node built-ins only, e.g. `node:test`; no install step).
- `task.md` the prompt.
- `task.json` `{ "check": "<command>" }`, run in the workspace after the agent finishes; exit 0 passes.
- `check.*` hidden test files, copied into the workspace only after the agent finishes.
- `fake/` files the `--fake` model writes (the reference solution).

## Add a preset

`presets/<name>/preset.json`: `{ "description": "...", "config": { ... }, "verify": { ... } }`. `config` is merged into HostConfig as-is (`agentOverrides`, `modelTiers`, `agentRoles`, ...; unknown keys are not validated here). `verify` is written to `<workspace>/.pista/verify.json`. An optional `presets/<name>/agents/*.md` is copied to `<workspace>/.pista/agents/`. Keys not set by a preset are reset between runs. The baseline `solo` sets nothing.
