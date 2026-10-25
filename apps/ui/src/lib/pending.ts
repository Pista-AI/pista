import type { ChatMessage } from "@pista/protocol";

/**
 * Optimistic user messages: `send` appends the user's message right away; the host echoes it
 * only after its pre-run steps (model preparation, thinking decision). When the echo arrives
 * it replaces (moves to the end) the oldest pending entry instead of being appended a second time.
 * Returns undefined when the incoming message is not an echo of a pending one.
 */
export function adoptPending(
  messages: ChatMessage[],
  pending: ChatMessage[],
  incoming: ChatMessage,
): { messages: ChatMessage[]; pending: ChatMessage[] } | undefined {
  if (incoming.role !== "user" || pending.length === 0) return undefined;
  if (textOf(incoming) !== textOf(pending[0])) return undefined;
  // Move to the end, not in place: the host may emit other messages (the system prompt of a new
  // thread) before the echo, and message_end finds the echo as the last message.
  return { messages: [...messages.filter((m) => m !== pending[0]), incoming], pending: pending.slice(1) };
}

/** The text of a user message; images are ignored. */
function textOf(m: ChatMessage): string {
  if (m.role !== "user") return "";
  return typeof m.content === "string" ? m.content : m.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}
