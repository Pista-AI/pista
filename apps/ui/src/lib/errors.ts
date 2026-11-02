export interface TurnError {
  kind: "auth" | "other";
  /** One plain line, safe to show: no response bodies, no secrets. */
  text: string;
}

const AUTH = /oauth refresh failed|\b40[13]\b|unauthori[sz]ed|forbidden|invalid[ _-]?(api[ _-]?)?key|incorrect api key|no api key|missing api key|api key (is )?(missing|invalid|not)|authentication/i;
const SECRET = /sk-[\w-]+|bearer\s+\S+|\b[A-Za-z0-9+/_-]{32,}={0,2}|\b[0-9a-f]{24,}\b/gi;
const MAX = 160;

/** The first line of an error message, cut at the first "{" (a JSON body) and stripped of anything that looks like a key or token. */
export function safeFirstLine(message: string): string {
  const line = (message.split(/[\r\n]/)[0] ?? "").split("{")[0] ?? "";
  const clean = line.replace(SECRET, "").replace(/\s+/g, " ").replace(/[\s:(,-]+$/, "").trim();
  return clean.length > MAX ? `${clean.slice(0, MAX - 1).trimEnd()}…` : clean;
}

/** Turns a failed turn's raw error message into a short, safe line that names the provider and says what to do. */
export function describeTurnError(message: string | undefined, provider: string): TurnError {
  const raw = message ?? "";
  if (AUTH.test(raw)) return { kind: "auth", text: `${provider}: sign-in expired or was rejected. Sign in again in Settings, or switch this thread to another model.` };
  let reason: string;
  if (/\b429\b|rate.?limit|too many requests/i.test(raw)) reason = "rate limit reached. Wait a moment and try again.";
  else if (/context.{0,20}(length|window)|too many tokens|maximum context/i.test(raw)) reason = "the conversation is too long for this model.";
  else if (/fetch failed|network|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|timed? ?out/i.test(raw)) reason = "could not reach the service. Check your connection and try again.";
  else reason = safeFirstLine(raw) || "the model returned an error.";
  return { kind: "other", text: `${provider}: ${reason}` };
}
