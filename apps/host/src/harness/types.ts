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
}

export function defineHarness(h: Harness): Harness {
  return h;
}
