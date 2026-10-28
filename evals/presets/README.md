# Preset eval

Compares harness presets (HostConfig fragments) on a fixed set of tiny coding tasks and reports pass rate, mean cost, mean tokens and mean time per preset. The runner lives in `apps/host/src/eval/`; it drives a real `ThreadManager` in-process (no Electron), so the host's gates apply.

## Run

```
# No API calls: a scripted fake model writes each task's `fake/` solution.
pnpm eval:presets --fake --presets solo,routed --tasks '*' --runs 1

# Real (paid) run. --max-usd and --model are required.
pnpm eval:presets --presets solo,routed --tasks 'fix-*' --runs 3 --max-usd 2 --model anthropic/claude-sonnet-4-5
```

Options: `--presets a,b`, `--tasks name,name|prefix*|*`, `--runs N`, `--max-usd X`, `--model provider/id`, `--judge provider/id`, `--run-timeout SEC`, `--fake`, `--out DIR` (default `evals/presets/results/<timestamp>/`, git-ignored). Output: `report.json` (every run plus summary) and `report.md` (the table, including mean `agent` tool calls per run and the verify gate's pass/fail/skip counts). The gate runs only after a sub-agent that edited files (the `implementer` role), so read-only explorer delegation leaves it at 0/0/0. Node >= 22.18 is needed to run the `.ts` fixtures.

## Quality: diff and blind reviewer

Passing the hidden check says little about code quality, so every run also records the diff of its workspace against the fixture (taken when the agent finishes, before the check files are copied in; `.pista/` is excluded; truncated to 20 000 characters). report.json keeps `diff` and `diffStats` `{ files, added, removed }` per run, and report.md shows `mean diff lines`.

With `--judge provider/id` (checked against the registry like `--model`; any value in `--fake`) one reviewer call per run scores the diff 1-5 on `spec` (does exactly what the task asked, names and scope included), `minimal` (no unrelated edits), `readable` (clear, idiomatic, matches the surrounding style) and `safe` (no regressions, edge cases handled, tests not weakened), each with a one-line reason, as strict JSON. The reviewer is blind: it sees only the task text and the diff, never the preset, model, cost or check result. It uses the run's own copied credentials and has a 120 s limit. report.json gets `quality` `{ spec, minimal, readable, safe, mean, notes }` (or `judgeError` when the reply could not be parsed) and `judgeCostUsd`; report.md gets `mean quality (1-5)` (`–` when not judged). The reviewer's cost is kept apart from the run's `costUsd` but counts toward `totalCostUsd` and the `--max-usd` cap.

## Cost cap

Cost is the sum of Pi's per-message `usage.cost.total` over the parent thread and its sub-agent threads (also counted when a run errors or times out); nothing is priced by Pista. Before each run the runner checks the cumulative cost and, once it reaches `--max-usd` (`>=`), skips every remaining run, records `aborted` in the report and exits 1. The cap is checked between runs only, so the total can overshoot by up to one run. It is ineffective when the provider reports $0 (local models): keep `--runs` and the task count small there. `--run-timeout SEC` (default 600) aborts one run, records error `timeout` and moves on. `--runs`, `--max-usd` and `--run-timeout` must be positive numbers; `--model` is checked against the model registry before anything runs. The CLI exits 1 when the run was aborted or every run errored.

## Isolation and safety

Full-access approval is not a sandbox. The agent runs with your OS user's permissions and can read or write anything that user can, including this repo; the eval only keeps the agent's workspace and Pista's own state away from your real ones.

- Every run is its own process with a fresh `PISTA_HOME`, Pi agent dir (`PI_CODING_AGENT_DIR`) and memory dir (`PI_MEMORY_DIR`), all under a scratch temp dir that is deleted at the end (also in `--fake` mode). Your settings, `mcp.json`, sessions, memory and projects are never loaded.
- Real runs copy only `auth.json` and `models-store.json` from your Pi agent dir (`PI_CODING_AGENT_DIR`, else `$PISTA_HOME/pi`, else `~/.pista/pi`) into the scratch agent dir. The originals are never opened for writing; token refreshes land in the copy.
- The child process gets an allowlisted environment: PATH, HOME, TMPDIR, SHELL, LANG/LC_*, USER, TERM, provider keys (`*_API_KEY`, AWS_*, AZURE_*, GOOGLE_CLOUD_*, GOOGLE_APPLICATION_CREDENTIALS) and the three scratch overrides. All other `PISTA_*` / `PI_*` variables (policy URLs, tokens) and `NODE_OPTIONS` are dropped. `HOME` still points at your real home, so tools the agent runs can still read it.
- Ctrl-C / SIGTERM kills the running child's process group, deletes the scratch dir and exits 130. A run's check has its own 120 s limit (error `check timeout`).
- The workspace is a copy of the task's `fixture/`, trusted and set to full-access for that folder only. Fixtures are first staged in the scratch dir, so the workspace and prompt never mention repo paths. Real runs never stage `fake/`, and the hidden check files are copied into the staging dir only after the agent has finished, so they do not exist while it runs; this eval measures cooperative runs, not adversarial ones.
- Use real runs only on a machine where a full-access agent is acceptable.

## Tasks

`add-chunk` and `fix-slugify` are one-file tasks; parents rarely delegate on them. `fix-free-shipping` (find a bug from a symptom in a ~20-file shop backend) and `rename-product-sku` (a cross-file rename that must leave order and customer ids alone) are sized so delegating exploration can pay off.

## Add a task

`tasks/<name>/` with:
- `fixture/` the starting repo (node built-ins only, e.g. `node:test`; no install step).
- `task.md` the prompt.
- `task.json` `{ "check": "<command>" }`, run in the workspace after the agent finishes; exit 0 passes; a failing check's output tail is kept as `checkOutput` in report.json, and every run keeps the parent's last message (or provider error) as `finalText`.
- `check.*` hidden test files, copied into the workspace only after the agent finishes.
- `fake/` files the `--fake` model writes (the reference solution): only the files that change, nested paths allowed (`fake/src/a.ts` overwrites `src/a.ts`).

## Add a preset

`presets/<name>/preset.json`: `{ "description": "...", "config": { ... }, "verify": { ... } }`. `config` is merged into HostConfig as-is (`agentOverrides`, `modelTiers`, `agentRoles`, ...; unknown keys are not validated here). `verify` is written to `<workspace>/.pista/verify.json`. An optional `presets/<name>/agents/*.md` is copied to `<workspace>/.pista/agents/`. Every run starts from fresh state, so nothing leaks between runs. The baseline `solo` sets nothing.
