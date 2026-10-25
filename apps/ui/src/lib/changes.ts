import type { ChatMessage } from "@pista/protocol";

export interface FileChange {
  path: string;
  added: number;
  removed: number;
  /** Unified diffs (edit) or full contents (write), oldest first. */
  hunks: { kind: "patch" | "write"; text: string }[];
}

function countPatch(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

/** Files the agent changed in a thread, derived from successful edit/write tool calls. */
export function computeChanges(messages: ChatMessage[]): FileChange[] {
  const calls = new Map<string, { name: string; args: Record<string, unknown> }>();
  const files = new Map<string, FileChange>();
  for (const m of messages) {
    if (m.role === "assistant") {
      for (const b of m.content) if (b.type === "toolCall") calls.set(b.id, { name: b.name, args: b.arguments ?? {} });
      continue;
    }
    if (m.role !== "toolResult" || m.isError) continue;
    const call = calls.get(m.toolCallId);
    if (!call || (call.name !== "edit" && call.name !== "write")) continue;
    const path = String(call.args.path ?? "");
    if (!path) continue;
    const entry = files.get(path) ?? { path, added: 0, removed: 0, hunks: [] };
    if (call.name === "edit") {
      const patch = (m.details as { patch?: string } | undefined)?.patch ?? "";
      const n = countPatch(patch);
      entry.added += n.added;
      entry.removed += n.removed;
      entry.hunks.push({ kind: "patch", text: patch });
    } else {
      const content = String(call.args.content ?? "");
      entry.added += content ? content.split("\n").length : 0;
      entry.hunks.push({ kind: "write", text: content });
    }
    files.set(path, entry);
  }
  return [...files.values()];
}
