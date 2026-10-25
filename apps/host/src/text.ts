import type { ImageBlock, TextBlock } from "@pista/protocol";

/** A message body: plain text, or the content blocks Pi uses for user and tool-result messages. */
export type TextContent = string | readonly (TextBlock | ImageBlock)[];

/** One line of plain text: blocks are joined with spaces (images become "[image]"), whitespace runs collapse, ends are trimmed. */
function flattenText(content: TextContent): string {
  const text = typeof content === "string" ? content : content.map((b) => (b.type === "text" ? b.text : "[image]")).join(" ");
  return text.replace(/\s+/g, " ").trim();
}

/** `flattenText`, cut to at most `max` characters; a cut ends in an ellipsis that counts toward `max`. */
export function clip(content: TextContent, max: number): string {
  const flat = flattenText(content);
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
