import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { SliceRunner } from "./sliced/schedule.ts";

/** What the host gives a harness: the thread's own facts, never the host's internals. */
export interface HarnessHost {
  cwd: string;
  /** Runs one child agent; shared with the `agent` tool, so both count against the same child limit. */
  runAgent: SliceRunner;
  /** This harness's settings block (for sliced: `config.sliced`), read per call, not cached. */
  config<T>(): T | undefined;
  /** `HostConfig.contextWindowCap`: the window the thread is held to, whatever the model advertises. */
  windowCap(): number | undefined;
  readOnlyTools: readonly string[];
  state: {
    /** Latest custom session entry of `kind`, or undefined. */
    read<T>(kind: string): T | undefined;
  };
}

/** What a harness may read before any agent runs (prompt and tools): the host without the runner. */
export type HarnessContext = Omit<HarnessHost, "runAgent">;

export interface SessionUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface SessionPart {
  type?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

/** One line of a kept Pi session file, as far as the eval reads it. */
export interface SessionEntryLike {
  type?: string;
  customType?: string;
  data?: Record<string, unknown>;
  timestamp?: string;
  parentSession?: string;
  message?: { role?: string; usage?: SessionUsage; content?: SessionPart[] };
}

/** How the preset eval learns about a harness: per-run metrics and one report column. */
export interface HarnessEval {
  /** Per-run metrics derived from the session entries (custom entries of this harness's `entries` kinds plus tool calls). */
  metrics(entries: readonly SessionEntryLike[]): Record<string, unknown> | undefined;
  /** One report column: header text and the cell for a preset's runs (runs with no metrics are passed as undefined). */
  column?: { header: string; cell(runs: readonly (Record<string, unknown> | undefined)[]): string };
}

/** A way of working a top-level thread: extra prompt section, tools and an extension. */
export interface Harness {
  id: string;
  prompt?(host: HarnessContext): string | undefined;
  tools?(host: HarnessContext): string[] | undefined;
  /** Absent when the harness only adds nothing (solo). */
  extension?(host: HarnessHost): InlineExtension;
  validateConfig?(raw: unknown): boolean;
  /** Custom session entry kinds the harness persists. */
  entries?: string[];
  /** Eval-report hooks; absent when the harness has nothing of its own to measure. */
  eval?: HarnessEval;
}

export function defineHarness(h: Harness): Harness {
  return h;
}
