# @pista/pi-browser

`browser_*` tools for Pi: ref-based page snapshots and one tool per action, over a small `BrowserDriver` interface (the app's built-in pane, or any Chromium over CDP).

Safety stops live in the tools (`src/safety.ts`): `browser_navigate` declines cookie banners, `browser_click`, `browser_type` (with submit) and `browser_press` (Enter, Space) hold consequential actions until the user approves that exact action through the host (`src/approval.ts`; the tools have no argument for it), `browser_type` refuses password fields.

## Eval suite

`test/suite.ts` runs ten real tasks headlessly over CDP (it never touches the app's browser pane). Each task is a Pi session built like the host's (`buildSession`) whose model drives the `browser_*` tools directly. It prints a table with task, ok, status, tool calls, model calls, tokens in/out and time.

```sh
# 1. an external Chrome with a DevTools port and its own profile (add --headless=new for a window-less run)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir=/tmp/pi-browser-test

# 2. the suite; MODEL is <provider>/<model id> and the id may contain slashes. The fixture pages are served by the suite itself.
PI_BROWSER_CDP_URL=http://127.0.0.1:9222 MODEL=nebius/deepseek-ai/DeepSeek-V4-Flash-0731 pnpm eval:browser [task-name ...]

# a local llama-server (URL without /v1): registers the llama.cpp provider advertising a 32768-token window, so start it with -c 32768 or more
# (a smaller -c makes the session auto-compact after a snapshot or two). THINKING=off|low|... is an explicit level; leave it out for auto,
# which like the app pins temperature 0 on planner turns inside a browsing sequence and leaves thinking at the default. SUITE_TASKS=a,b picks tasks like positional names.
LLAMA_BASE_URL=http://127.0.0.1:8080 MODEL=llama.cpp/<model id> THINKING=off pnpm eval:browser fixture-form
```

State goes to a fresh temp dir unless you set `PISTA_HOME`; the suite never touches `~/.pista` or copies `~/.pi/agent`, so use `PISTA_HOME` with sign-ins or an API key (Nebius: `NEBIUS_API_KEY`). It exits 1 when a task with a known answer fails. `TASK_TIMEOUT_S` bounds each task (default 300). To run the host against the same Chrome: `PISTA_BROWSER_DRIVER=cdp PI_BROWSER_CDP_URL=http://127.0.0.1:9222 pnpm dev`.

## Context compaction

Page views (snapshots, reads, screenshots and the results of click/type/select/press/scroll/back) are first collapsed to one line when they are old or from a document the model left (stage 1, see Context collapse below). Once the estimated request passes a budget, all but the latest page view are also replaced at once by a header plus a short stub, and stay stubbed from then on (stage 2). The latest page view is always kept in full.

`PI_BROWSER_COMPACT_AT` sets the budget: a number up to 1 is a fraction of the model's context window, a larger number is an absolute count of tokens. The default is 0.65 (65% of the window; 32768 if the model reports none). The estimate of the next request uses the real prompt-token count reported by the previous model reply plus a conservative estimate (2.5 characters per token) of what was appended since. Before any reply carries usage it estimates the messages the same way plus the system prompt and tool definitions (a fixed 2,500 tokens if the host does not expose them). The 2.5 ratio and the overhead are calibrated against Gemma 4 traces from Oct 20 2026, where the old characters / 4 estimate ignored the overhead and undercounted by a median 1.58x.

## Context collapse

Compaction runs in two stages, both on the request only (the session file keeps the full results).

Stage 1 runs on every request. Page views are grouped by document (the URL without its `#fragment`). The newest view is always kept in full, and so is the latest snapshot-producing view of the same document (a `browser_read` or screenshot does not move the delta baseline) with the full snapshot and any deltas it builds on. Per document, the latest view stays in full while that document is current or the model left it at most `staleDocumentTurns` assistant turns ago (default 1); after that every view of it collapses. All other page views collapse to one line, and the JSON header goes too:

```
[earlier view of shop.test/a: Shop home, 26 elements; acted on: e12 (click "Contact"), e20..e24 (fill)]
```

The path is host plus pathname, the title is cut at 60 characters, and `N elements` comes from the snapshot's first line (`text view` for `browser_read`, nothing for deltas and screenshots). `acted on` lists the actions the model issued while that view was its latest, with the element name looked up in the view; it is left out when there were none and cut with `, …` to keep the line under about 300 characters. A failed result becomes `[earlier failed browser_click on shop.test/a]`. Collapsing is sticky by tool-call id: a collapsed view stays collapsed in later requests, so the prompt before it does not change. Results without a tool-call id and `browser_navigate` results are never touched.

Stage 2 is the budget pass described above (`PI_BROWSER_COMPACT_AT`): it stubs every page view still in full beyond the newest `keep`. Delta baselines are invalidated only when it removes a view the next delta would be read against: the newest view, the latest snapshot-producing view (browser_read and browser_screenshot do not set the delta baseline, so stage 1 keeps the last snapshot in full while they are newest) and the deltas in between.

`PI_BROWSER_STALE_DOC_TURNS` (a whole number, default 1) or the `staleDocumentTurns` option of `registerBrowserTools` sets how many assistant turns a left document stays in full; the env var is read on every request. The collapse runs on every request whatever `PI_BROWSER_COMPACT_AT` is; the only switch is `keepPageViews: 0`, which turns off both stages.

## Effect feedback (off by default)

With `PI_BROWSER_EFFECT_FEEDBACK=1`, `browser_click`, `browser_type`, `browser_select` and `browser_press` read the page just before and just after the action and append a plain-words summary of what changed to the result: the URL or title, the target field's value (never for passwords, card numbers or codes), toggles and lists that opened or closed, where focus went, or "No visible change yet.". It is off by default: a decision-point test showed no net gain, and it costs two extra page reads per action. When it is off those reads are skipped and the result keeps its plain wording (`Clicked button "Go".`). The flag is read on every action.

## Traces

Every `browser_*` call appends one JSON line (fields: `TraceLine` in `src/trace.ts`) to `<traceDir>/browser-traces/<utc-date>.jsonl`, so driver time and result sizes can be measured per action. Pista's host passes `traceDir` (`PISTA_HOME`), so tracing is on in the app unless `PI_BROWSER_TRACE_DIR=off`; that variable also overrides the directory, and with no directory at all it is off.

`ms` is driver time (waiting for the user's approval is left out) and `cdp` is CDP round trips; both assume tool calls run one at a time in a thread. `chars` is the size of the text result, `elements` and `mode` (`delta` or `full`) describe snapshot-like results, and `error` is a short code, never the message.

Nothing written contains page text, titles, typed or selected values, scripts, query strings or fragments, and tool inputs are never logged. The URL is host and path exactly as they are, so a path token such as `/reset/<token>` is kept.

## Delta results (on by default)

After an acting tool (`browser_click`, `browser_type`, `browser_select`, `browser_press`, `browser_scroll`), the result carries only what changed since the last page view the model saw, instead of the whole capped snapshot again: the lines that were added, removed or changed, a count of the elements that stayed the same, and a pointer to `browser_snapshot` for the full list. Refs are stable for the life of a document (an element keeps the ref it was first given, so two snapshots can be compared line by line), and a delta is only sent while the document and URL are the ones the model last saw and the diff is small; a navigation, a large change, or a page view dropped by context compaction gets the full snapshot, which becomes the new baseline. `browser_snapshot` always returns the full list. History stays append-only, so the prompt prefix and the server's prompt cache are unaffected. On the fixture page a type action's result is about 7.5 times smaller.

Set `PI_BROWSER_DELTA=0` to turn it off: every result is a full snapshot and refs are renumbered on each snapshot, as before. The flag is read on every action.

## browser_fill (on by default)

`browser_fill` sets several form fields in one call: `fields` is a list of `{ ref, value }` and an optional `submit` ref. Each field goes through the same page actions as `browser_type`, `browser_select` and `browser_click` (so the same stops apply: a secret field is not typed, a consequential click is held for the user), is read back, and gets one line in the result (`Cabin class = "Business" ✓`). The first field that fails ends the batch and nothing is submitted. One snapshot is taken at the end rather than one per field. A combobox with a suggestion list is filled by typing and picking the best-matching option, with a small built-in helper. On a form this halved the number of model turns, with every field correct.

Set `PI_BROWSER_FILL=0` to remove the tool. The flag is read when the tools are registered.

## browser_choose (off by default)

With `PI_BROWSER_CHOOSE=1`, `browser_choose` fills a combobox, autocomplete or dropdown and commits a value from its list in one call: it clears the field, types the text, waits for the suggestions to settle, clicks the best match and checks that the value stuck (falling back to ArrowDown and Enter when a click does not commit). It keys only on ARIA roles and attributes and refuses secret fields; an option that looks like buying, paying, sending or deleting is held for the user. It is off by default because it did not commit values on a live site yet: 0 verified commits in the spike. With it on, `browser_fill` hands its comboboxes to the same logic instead of its own helper. The flag is read when the tools are registered.

## Session analysis

`pnpm analyze:session <session.jsonl> [--traces <dir>]` prints a token report for one Pi session: per-turn prompt sizes, totals, the tool-result share of the prompt, tokens per browser action, and a join to browser trace lines.

Traces come from `--traces <dir>` (or its `browser-traces` child), else `$PISTA_HOME/browser-traces`, else `~/.pista/browser-traces`, for the UTC days the session spans. Only lines with a string `tool` and a numeric `ms` count; legacy `browser_agent` lines (with `kind`) are skipped.
