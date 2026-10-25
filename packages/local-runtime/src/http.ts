/** A non-2xx answer. `detail` is the server's own error message when its body had one. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`);
    this.name = "HttpError";
  }
}

export interface FetchJsonOptions {
  method?: string;
  /** Sent as JSON; the method defaults to POST when there is a body. */
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs: number;
  /** Tests only. */
  fetch?: typeof fetch;
}

/** The message in `{error: {message}}`, `{error: "..."}` or `{message}` bodies, else the raw text (capped). */
function errorDetail(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: string | { message?: string }; message?: string };
    const message = typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? parsed.message);
    if (message) return message.trim();
  } catch {
    /* not JSON */
  }
  return text.slice(0, 300).trim();
}

/**
 * One JSON request with a timeout. Throws `HttpError` on a non-2xx answer; an empty 2xx body
 * reads as `{}` because some servers answer actions (load, unload) with no content.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions): Promise<T> {
  const { body, timeoutMs, headers } = options;
  const res = await (options.fetch ?? fetch)(url, {
    method: options.method ?? (body === undefined ? "GET" : "POST"),
    ...(headers || body !== undefined ? { headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers } } : {}),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, errorDetail(text));
  return (text.trim() ? JSON.parse(text) : {}) as T;
}
