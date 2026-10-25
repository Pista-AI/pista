/** A string that is nothing but a web address (with or without scheme for local hosts). */
export const URL_ONLY = /^(?:https?:\/\/[^\s`]+|(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s`]*)?)$/i;

export const withScheme = (url: string) => (/^https?:\/\//i.test(url) ? url : `http://${url}`);

/**
 * GFM already autolinks http(s):// and www. addresses. This also links bare local
 * addresses such as localhost:3000/apps, leaving fenced blocks and inline code untouched.
 */
export function linkifyLocal(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/(^|[\s(])((?:localhost|127\.0\.0\.1):\d+(?:\/[^\s)<>\]]*)?)/g, (_m, pre: string, addr: string) => {
            const trail = addr.match(/[.,;:!?]+$/)?.[0] ?? "";
            return `${pre}<http://${addr.slice(0, addr.length - trail.length)}>${trail}`;
          }),
    )
    .join("");
}

const URL_IN_TEXT = /https?:\/\/[^\s)\]>"'`]+|(?:localhost|127\.0\.0\.1):\d+/gi;
/** Search engines: agents may build search links without having "seen" them. */
const ALWAYS_OK = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com)$/i;

export function hostOf(url: string): string | null {
  try {
    return new URL(withScheme(url)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

type GroundingMessage =
  | { role: "user"; content: string | { type: string; text?: string }[] }
  | { role: "toolResult"; toolName?: string; isError: boolean; content: { type: string; text?: string }[] }
  | { role: string };

/**
 * Hosts the agent can legitimately link to: anything the user wrote, anything a successful
 * tool returned (pages opened or read, search results), and the browser home page.
 */
export function groundedHosts(messages: GroundingMessage[], homeUrl?: string): Set<string> {
  const hosts = new Set<string>();
  const add = (text: string) => {
    for (const match of text.match(URL_IN_TEXT) ?? []) {
      const host = hostOf(match);
      if (host) hosts.add(host);
    }
  };
  if (homeUrl) add(homeUrl);
  for (const m of messages) {
    if (m.role === "user" && "content" in m) {
      add(typeof m.content === "string" ? m.content : m.content.map((b) => b.text ?? "").join(" "));
    } else if (m.role === "toolResult" && "isError" in m && !m.isError) {
      const blocks = m.content.map((b) => b.text ?? "");
      if (m.toolName?.startsWith("browser_")) {
        // The first block echoes the URL the agent asked for. It only proves the site exists
        // when the page really loaded (has a title, no failure or cross-origin note).
        try {
          const meta = JSON.parse(blocks[0] ?? "{}") as { url?: string; title?: string; note?: string };
          if (meta.url && meta.title && !meta.note) add(meta.url);
        } catch {
          /* not JSON: ignore the echo */
        }
        blocks.slice(1).forEach(add);
      } else {
        blocks.forEach(add);
      }
    }
  }
  return hosts;
}

export function isGrounded(url: string, hosts: Set<string> | null): boolean {
  if (!hosts) return true;
  const host = hostOf(url);
  return !host || ALWAYS_OK.test(host) || hosts.has(host);
}
