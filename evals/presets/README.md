# Preset eval

Compares harness presets (HostConfig fragments) on a fixed set of tiny coding tasks and reports pass rate, mean cost, mean tokens and mean time per preset. The runner lives in `apps/host/src/eval/`; it drives a real `ThreadManager` in-process (no Electron), so the host's gates apply.

## Run

```
# No API calls: a scripted fake model writes each task's `fake/` solution.
pnpm eval:presets --fake --presets solo,routed --tasks '*' --runs 1

# Real (paid) run. --max-usd and --model are required.
pnpm eval:presets --presets solo,routed --tasks 'fix-*' --runs 3 --max-usd 2 --model anthropic/claude-sonnet-4-5
```

Options: `--presets a,b`, `--tasks name,name|prefix*|*`, `--runs N`, `--max-usd X`, `--model provider/id`, `--judge provider/id`, `--run-timeout SEC`, `--fake`, `--no-sessions`, `--out DIR` (default `evals/presets/results/<timestamp>/`, git-ignored). Output: `report.json` (every run plus summary) and `report.md` (the table, including mean `agent` tool calls per run and the verify gate's pass/fail/skip counts). The gate runs only after a sub-agent that edited files (the `implementer` role), so read-only explorer delegation leaves it at 0/0/0. Each run's Pi session transcripts (parent and sub-agents; only `*.jsonl` files from its `home` and `agent` dirs, never auth, credentials or models files) are copied to `<out>/sessions/<preset>/<task>-<run>/` and referenced as `sessionsDir` in report.json; `--no-sessions` skips this. Node >= 22.18 is needed to run the `.ts` fixtures.

## Quality: diff and blind reviewer

Passing the hidden check says little about code quality, so every run also records the diff of its workspace against the fixture (taken when the agent finishes, before the check files are copied in; `.pista/` is excluded; truncated to 20 000 characters). report.json keeps `diff` and `diffStats` `{ files, added, removed }` per run, and report.md shows `mean diff lines`.

With `--judge provider/id` (checked against the registry like `--model`; any value in `--fake`) one reviewer call per run scores the diff 1-5 on `spec` (does exactly what the task asked, names and scope included), `minimal` (no unrelated edits), `readable` (clear, idiomatic, matches the surrounding style), `safe` (no regressions, edge cases handled, tests not weakened) and `structure` (fits the existing structure: new code lives where similar code lives, reuses existing helpers instead of duplicating them, no copy-pasted logic), each with a one-line reason, as strict JSON. The reviewer is blind: it sees only the task text, the diff and the paths of the fixture's files (paths only, no contents, at most 200 entries, so it can notice a new helper beside an existing one), never the preset, model, cost or check result. It uses the run's own copied credentials and has a 120 s limit. For reasoning models the call uses the lowest thinking level (`reasoning: "minimal"`) and a 16000-token budget so thinking cannot use up the reply (earlier runs hit `reviewer stopped: length`). report.json gets `quality` `{ spec, minimal, readable, safe, structure, mean, notes }` (or `judgeError` when the reply could not be parsed, including a reply without all five scores) and `judgeCostUsd`; `mean` is the average of the five. report.md gets `mean quality (1-5)` (`–` when not judged). The reviewer's cost is kept apart from the run's `costUsd` but counts toward `totalCostUsd` and the `--max-usd` cap.

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

The harder tasks below (Node >= 22.18 to run the `.ts` files) each have a `tsconfig.json` next to `package.json` (strict, `noEmit`, with a small `types/node.d.ts` for the node built-ins used, so no `@types/node` is needed) so a typecheck gate can run on them.
- `ambiguous-export` asks for a CSV export of a report without saying delimiter, columns, quoting or date format. The check only guards correctness against the repo's conventions (header row = the JSON export's fields in its order, compared case-insensitively; delimiter `,` `;` or tab detected from the header; the existing date/amount formatters; RFC 4180 quoting; one row per entry is expected, so no total row). Judging how the agent handled the ambiguity (a stated assumption or a question) is for the reviewer, not the check.
- `reuse-existing-helper` needs a cent-exact bill split, and a tested `allocate` helper already exists in another module. The check tests behaviour and reads the sources: the new file must import `allocate`, and the remainder logic must not be copied. Failures are labelled `BEHAVIOUR WRONG` or `NOT REUSED / DUPLICATED`, so a fail can be reuse-only.
- `fix-far-bug` reports a wrong total at the edge (an invoice for a Norwegian customer) whose root cause is an alias table two call layers down; the check also exercises the other callers of the shared normaliser (shipping zone, currency, region), so a patch at the edge fails.
- `spec-many-files` is an exact spec (adding a `currency` field to `Price`: defaults, error text, output formats, JSON back-compat) across about ten files; the check verifies every point literally and that unrelated behaviour is unchanged.
- `explore-large` (49 files in 13 domains, with a deprecated module, dead code and a look-alike bank-day calendar as distractors) asks for holiday-aware shipping dates ("the holiday calendar already exists"). The reference change touches 4 files: the business-day helpers, `dispatchDate` and its two callers (`orders/place.ts`, `orders/eta.ts`); the check also guards that the shared calendar and bank settlement keep their old behaviour.

## Add a task

`tasks/<name>/` with:
- `fixture/` the starting repo (node built-ins only, e.g. `node:test`; no install step).
- `task.md` the prompt.
- `task.json` `{ "check": "<command>" }`, run in the workspace after the agent finishes; exit 0 passes; a failing check's output tail is kept as `checkOutput` in report.json, and every run keeps the parent's last message (or provider error) as `finalText`.
- `check.*` hidden test files, copied into the workspace only after the agent finishes.
- `fake/` files the `--fake` model writes (the reference solution): only the files that change, nested paths allowed (`fake/src/a.ts` overwrites `src/a.ts`).

## Add a preset

`presets/<name>/preset.json`: `{ "description": "...", "config": { ... }, "verify": { ... } }`. `config` is merged into HostConfig as-is (`agentOverrides`, `modelTiers`, `agentRoles`, ...; unknown keys are not validated here). `verify` is written to `<workspace>/.pista/verify.json`. An optional `presets/<name>/agents/*.md` is copied to `<workspace>/.pista/agents/`. Every run starts from fresh state, so nothing leaks between runs. The baseline `solo` sets nothing. `lean-tools` is `solo` with `memoryEnabled`, `webSearchEnabled` and `browserEnabled` set to `false`: those tools (pi-memory, pi-web-access, the `browser_*` tools) and their system-prompt guidance are left out of every thread, so it measures what a shorter tool list does for a coding task. `browserEnabled` is optional in HostConfig; absent means on. The loop guard stops a run after 60 tool calls; `maxToolCalls` raises that for the top-level thread (`HostConfig.maxToolCalls`) or for one role's sub-agents (`agentOverrides.<role>.maxToolCalls`), each a positive integer up to 1000. The Nebius delegation presets set 150 for the parent and explorers, since 60 stopped them on the 49-file `explore-large` task.

The verify gate also runs a typecheck when the task workspace has a root `tsconfig.json` (see `docs/ARCHITECTURE.md`): the project's `typecheck` script, else its own `tsc`, else a `tsc` the host can resolve, else it is skipped. Eval fixtures have no `node_modules`, so they use the host's tsc. Set `"typecheck": false` or a command in a preset's `verify` to override.
