import { randomUUID } from "node:crypto";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { DecisionEntry } from "@pista/protocol";
import { ENTRY, readCustomEntries, writeCustomEntry } from "./session.ts";

/** In-memory cap per thread; the session file keeps every decision. */
export const MAX_DECISIONS = 500;

export type DecisionInput = Omit<DecisionEntry, "id" | "ts">;

/** What the goal loop, plan tool and agent tool call to log a decision. */
export type RecordDecision = (entry: DecisionInput) => void;

/** A thread's decision log: why the loop or the model did what it did, kept in the session file. */
export class DecisionLog {
  private entries: DecisionEntry[] = [];

  constructor(
    private sessionManager: SessionManager,
    private emit: (decision: DecisionEntry) => void,
  ) {}

  /** Assigns id and timestamp, stores the entry (memory and session file) and tells the UI. */
  record(input: DecisionInput): DecisionEntry {
    const entry: DecisionEntry = { id: randomUUID(), ts: Date.now(), ...input };
    this.entries.push(entry);
    if (this.entries.length > MAX_DECISIONS) this.entries.splice(0, this.entries.length - MAX_DECISIONS);
    writeCustomEntry(this.sessionManager, ENTRY.decision, entry);
    this.emit(entry);
    return entry;
  }

  list(): DecisionEntry[] {
    return [...this.entries];
  }

  /** Replaces the in-memory list with the decisions stored in the session, oldest first. */
  restore(sessionManager: SessionManager = this.sessionManager): void {
    this.entries = readCustomEntries<DecisionEntry>(sessionManager, ENTRY.decision).slice(-MAX_DECISIONS);
  }
}
