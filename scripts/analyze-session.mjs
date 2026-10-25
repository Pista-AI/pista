#!/usr/bin/env node
// Token report for one Pi session file, joined to browser trace lines when present.
// Usage: pnpm analyze:session <session.jsonl> [--traces <dir>]

import { existsSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';

const USAGE = 'usage: pnpm analyze:session <session.jsonl> [--traces <dir>]';
const CHARS_PER_TOKEN = 3.6; // est. tokens = chars / 3.6
const TOLERANCE_MS = 2000; // the last trace ts can land just after the last toolResult stamp
const SOURCES = ['browser', 'search', 'other'];

const fail = (msg) => {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const signed = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n));
const pct = (part, whole) => (whole > 0 ? `${((100 * part) / whole).toFixed(1)}%` : 'n/a');
const cell = (v) => (v === undefined || v === null || v === '' ? '-' : typeof v === 'number' ? fmt(v) : String(v));
const isFile = (p) => existsSync(p) && statSync(p).isFile();
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const sourceOf = (name) => (name.startsWith('browser_') ? 'browser' : ['web_search', 'fetch_content'].includes(name) ? 'search' : 'other');
const textOf = (m) => {
  if (typeof m.content === 'string') return m.content;
  if (!Array.isArray(m.content)) return '';
  return m.content.filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('');
};
const hms = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// Aligned plain-text table; columns listed in rightCols are right-aligned.
function table(headers, rows, rightCols) {
  const all = [headers, ...rows].map((r) => r.map(String));
  const widths = headers.map((_, c) => Math.max(...all.map((r) => r[c].length)));
  return all.map((r) => r.map((t, c) => (rightCols.includes(c) ? t.padStart(widths[c]) : t.padEnd(widths[c]))).join('  ').trimEnd());
}

function parseArgs(argv) {
  const i = argv.indexOf('--traces');
  const traces = i === -1 ? null : (argv[i + 1] ?? null);
  const positional = argv.filter((_, j) => i === -1 || (j !== i && j !== i + 1));
  if (positional.length !== 1 || (i !== -1 && !traces)) fail(USAGE);
  return { file: positional[0], traces };
}

// --traces (or its browser-traces child when that exists), else $PISTA_HOME/browser-traces, else ~/.pista/browser-traces.
function traceFolder(traces, base) {
  if (traces !== null) {
    const dir = resolve(base, traces);
    return isDir(join(dir, 'browser-traces')) ? join(dir, 'browser-traces') : dir;
  }
  return join(resolve(base, process.env.PISTA_HOME || join(os.homedir(), '.pista')), 'browser-traces');
}

// Browser tool lines only. Legacy browser_agent lines carry a `kind` and a ms object, so they are skipped.
function readTraces(files, startMs, endMs) {
  const out = [];
  for (const file of files.filter(isFile)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof o?.tool !== 'string' || typeof o.ms !== 'number' || o.kind !== undefined || typeof o.ts !== 'string') continue;
      const at = Date.parse(o.ts);
      if (Number.isFinite(at) && at >= startMs && at <= endMs + TOLERANCE_MS) out.push({ ...o, at });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

function traceSection({ traces, base, sessionId, startMs, endMs, wallMs, calls }) {
  const dir = traceFolder(traces, base);
  const days = [...new Set([dayOf(startMs), dayOf(endMs + TOLERANCE_MS)])];
  const files = days.map((d) => join(dir, `${d}.jsonl`));
  if (!files.some(isFile)) return [`no trace file: looked for ${days.map((d) => `${d}.jsonl`).join(', ')} in ${dir}`];

  const all = readTraces(files, startMs, endMs);
  const own = all.filter((t) => t.threadId === sessionId); // trace threadId is the Pi session id
  const lines = own.length > 0 ? own : all;
  const n = Math.max(calls.length, lines.length);
  if (n === 0) return ['no browser_* calls and no trace lines in the session window'];

  const out = calls.length !== lines.length
    ? [`note: ${calls.length} browser_* calls, ${lines.length} trace lines in the window; paired by order`]
    : [];
  let sumMs = 0;
  let mismatches = 0;
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const t = lines[i];
    const c = calls[i];
    if (t && c && t.tool !== c.name) mismatches += 1;
    if (t) sumMs += t.ms;
    const error = t?.error ? String(t.error) : t?.isError === true ? 'yes' : '-';
    rows.push([i + 1, t ? t.tool : c.name, cell(t?.ms), cell(t?.chars), cell(t?.elements), cell(t?.mode), cell(t?.cdp), error]);
  }
  out.push(...table(['#', 'tool', 'driver ms', 'chars', 'elements', 'mode', 'cdp', 'error'], rows, [0, 2, 3, 4, 6]));
  out.push('', `driver ms total ${fmt(sumMs)}  (${pct(sumMs, wallMs)} of wall time ${hms(wallMs)})`);
  if (mismatches > 0) out.push(`note: ${mismatches} paired row(s) have a different tool name in the trace`);
  return out;
}

function main() {
  const base = process.env.INIT_CWD || process.cwd(); // pnpm sets INIT_CWD to where it was invoked
  const { file, traces } = parseArgs(process.argv.slice(2));
  const sessionPath = resolve(base, file);
  let raw;
  try {
    raw = readFileSync(sessionPath, 'utf8');
  } catch (err) {
    fail(`analyze-session: cannot read ${sessionPath} (${err.code ?? err.message})`);
  }

  const records = [];
  for (const line of raw.split('\n')) {
    try {
      const o = JSON.parse(line);
      if (o && typeof o === 'object') records.push(o);
    } catch {
      // malformed lines are skipped silently
    }
  }
  const sessionId = records.find((r) => r.type === 'session' && typeof r.id === 'string')?.id ?? null;
  const messages = records
    .filter((r) => r.type === 'message' && r.message && typeof r.message === 'object')
    .map((r) => ({ at: Date.parse(r.timestamp), m: r.message }));
  const stamps = messages.map((x) => x.at).filter(Number.isFinite);
  const startMs = stamps.reduce((a, b) => Math.min(a, b), Infinity);
  const endMs = stamps.reduce((a, b) => Math.max(a, b), -Infinity);
  const wallMs = stamps.length ? endMs - startMs : 0;

  const first = messages.find((x) => x.m.role === 'assistant' && typeof x.m.model === 'string');
  const model = first ? (first.m.provider ? `${first.m.provider}/${first.m.model}` : first.m.model) : 'unknown';

  const turns = [];
  const toolCounts = new Map();
  const calls = [];
  const resultTokens = { browser: 0, search: 0, other: 0 };
  const cumulative = { browser: 0, search: 0, other: 0 };
  const shareNum = { browser: 0, search: 0, other: 0 };
  const sums = { input: 0, cacheRead: 0, output: 0, prompt: 0 };
  let userTurns = 0;
  let prev = 0;
  for (const { at, m } of messages) {
    if (m.role === 'user') {
      userTurns += 1;
    } else if (m.role === 'assistant') {
      const u = m.usage ?? {};
      const input = num(u.input);
      const cacheRead = num(u.cacheRead);
      const output = num(u.output);
      const prompt = input + cacheRead;
      turns.push({ turn: turns.length + 1, input, cacheRead, output, prompt, growth: prompt - prev });
      prev = prompt;
      Object.assign(sums, { input: sums.input + input, cacheRead: sums.cacheRead + cacheRead, output: sums.output + output, prompt: sums.prompt + prompt });
      for (const s of SOURCES) shareNum[s] += cumulative[s]; // each result counts toward every later prompt
      for (const part of Array.isArray(m.content) ? m.content : []) {
        if (part?.type === 'toolCall' && typeof part.name === 'string') {
          toolCounts.set(part.name, (toolCounts.get(part.name) ?? 0) + 1);
          calls.push({ name: part.name, at });
        }
      }
    } else if (m.role === 'toolResult') {
      const name = typeof m.toolName === 'string' ? m.toolName : '?';
      const est = [...textOf(m)].length / CHARS_PER_TOKEN; // code points, like the prototype's len()
      cumulative[sourceOf(name)] += est;
      resultTokens[sourceOf(name)] += est;
    }
  }

  const toolsByName = [...toolCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const browserCalls = calls.filter((c) => c.name.startsWith('browser_'));
  const nb = browserCalls.length;
  const out = [
    `session  ${basename(sessionPath)}`,
    `model    ${model}`,
    `wall     ${stamps.length ? hms(wallMs) : 'n/a'}`,
    `turns    ${turns.length} assistant, ${userTurns} user`,
    `tools    ${calls.length} calls: ${toolsByName.map(([n, c]) => `${n} ${c}`).join(', ') || 'none'}`,
    '',
    'Per turn',
    ...table(
      ['turn', 'input', 'cacheRead', 'output', 'prompt', 'growth'],
      turns.map((t) => [t.turn, fmt(t.input), fmt(t.cacheRead), fmt(t.output), fmt(t.prompt), signed(t.growth)]),
      [0, 1, 2, 3, 4, 5],
    ),
    '',
    'Totals',
    ...[['input', sums.input], ['cacheRead', sums.cacheRead], ['output', sums.output], ['prompt total', sums.prompt]].map(
      ([k, v]) => `  ${k.padEnd(13)}${fmt(v).padStart(10)}`,
    ),
    '  (prompt total = input + cacheRead)',
    '',
    'Tool results by source (est., chars / 3.6)',
    ...table(
      ['source', 'share of prompt (est., before pruning)', 'est. result tokens'],
      SOURCES.map((s) => [s, pct(shareNum[s], sums.prompt), fmt(resultTokens[s])]),
      [1, 2],
    ),
    '',
    'Per browser action',
    ...(nb
      ? [
          `  browser_* calls                 ${fmt(nb)}`,
          `  prompt tokens per call          ${fmt(sums.prompt / nb)}`,
          `  est. result tokens per call     ${fmt(resultTokens.browser / nb)}`,
        ]
      : ['  n/a (no browser_* calls)']),
    '',
    'Browser trace join',
    ...(Number.isFinite(startMs)
      ? traceSection({ traces, base, sessionId, startMs, endMs, wallMs, calls: browserCalls })
      : ['no timestamps in session']),
  ];
  process.stdout.write(`${out.join('\n')}\n`);
}

main();
