/** One JSON line per browser_* call in `<traceDir>/browser-traces/<utc-date>.jsonl`: timings and sizes only, never page text, titles,
 * typed or selected values, scripts or query strings (tool inputs are not logged). */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RiskApprover } from "./approval.ts";
import type { BrowserDriver } from "./driver.ts";

export interface TraceLine {
  ts: string;
  threadId?: string;
  tool: string;
  /** Host and path only (see redactUrl). */
  url?: string;
  /** Driver time: approval waits are left out. */
  ms: number;
  /** Size of the text result returned to the model. */
  chars: number;
  elements?: number;
  mode?: "delta" | "full";
  /** CDP round trips, when the driver counts them. */
  cdp?: number;
  isError: boolean;
  /** A short code, never the message. */
  error?: string;
}

/** Host and path as they are (so a path token is kept); no scheme, userinfo, query or fragment. Non-web URLs give nothing. */
export function redactUrl(url: string | undefined): string | undefined {
  try {
    const u = new URL(url ?? "");
    return u.protocol === "http:" || u.protocol === "https:" ? `${u.host}${u.pathname}`.slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}

/** `PI_BROWSER_TRACE_DIR` overrides `option`; "off" or neither set means no tracing. Writing never throws: one warning, then silence. */
export function createTracer(option: string | undefined, env: NodeJS.ProcessEnv = process.env): ((line: TraceLine) => void) | undefined {
  const dir = (env.PI_BROWSER_TRACE_DIR || option || "").trim();
  if (!dir || dir.toLowerCase() === "off") return undefined;
  const folder = join(dir, "browser-traces");
  let state: "new" | "ready" | "failed" = "new";
  return (line) => {
    if (state === "failed") return;
    try {
      if (state === "new") (mkdirSync(folder, { recursive: true, mode: 0o700 }), (state = "ready"));
      appendFileSync(join(folder, `${line.ts.slice(0, 10)}.jsonl`), `${JSON.stringify(line)}\n`, { mode: 0o600 });
    } catch (error) {
      state = "failed";
      console.warn(`[pi-browser] browser traces disabled: ${(error as Error).message}`);
    }
  };
}

export function errorCode(error: unknown, signal?: AbortSignal): string {
  const text = `${(error as Error)?.name} ${(error as Error)?.message}`;
  if (signal?.aborted || /abort/i.test(text)) return "aborted";
  return /time(d)?[ -]?out/i.test(text) ? "timeout" : /stale|not found/i.test(text) ? "stale-ref" : "error";
}

/** Size of what the model got and, for snapshot-like text, delta or full and how many elements it covers. */
export function describeResult(text: string): Pick<TraceLine, "chars" | "elements" | "mode"> {
  // Delta markers first: a capped-page delta can also contain an "N interactive elements listed" line.
  if (!/\(delta since last view\)|changed since the last view\./.test(text)) {
    const full = /^(\d+) interactive elements/m.exec(text);
    return full ? { chars: text.length, elements: Number(full[1]), mode: "full" } : { chars: text.length };
  }
  const changed = text.split("\n").filter((l) => /^[+~-] /.test(l)).length;
  return { chars: text.length, elements: changed + Number(/(\d+) other elements unchanged/.exec(text)?.[1] ?? 0), mode: "delta" };
}

type AnyTool = { name: string; execute: (...args: any[]) => Promise<any> };

/**
 * When tracing is on, returns `pi` wrapped so every browser_* tool registered through it writes one trace line, and
 * `askApproval` wrapped to time the user's wait (not driver time). Otherwise both come back unchanged.
 * Assumes sequential tool calls in a thread: `ms` and `cdp` mix if two calls overlap.
 */
export function traceTools(pi: ExtensionAPI, driver: () => BrowserDriver | Promise<BrowserDriver>, options: { traceDir?: string; threadId?: string; askApproval?: RiskApprover }) {
  const write = createTracer(options.traceDir);
  if (!write) return { pi, askApproval: options.askApproval };
  let waited = 0;
  const askApproval: RiskApprover | undefined = options.askApproval && (async (req) => {
    const at = Date.now();
    try {
      return await options.askApproval!(req);
    } finally {
      waited += Date.now() - at;
    }
  });
  // Stats are read inside the measured window: the first call may create the driver, which is driver time anyway.
  const roundTrips = async () => (await driver()).stats?.().roundTrips;

  const run = async (tool: AnyTool, args: any[]) => {
    const ts = new Date().toISOString();
    const start = performance.now();
    const waited0 = waited;
    const cdp0 = await roundTrips().catch(() => undefined);
    const record = async (extra: Partial<TraceLine>, end: number) => {
      const cdp1 = await roundTrips().catch(() => undefined);
      write({ ts, ...(options.threadId ? { threadId: options.threadId } : {}), tool: tool.name, ms: Math.max(0, Math.round(end - start - (waited - waited0))), chars: 0, ...(cdp0 !== undefined && cdp1 !== undefined ? { cdp: cdp1 - cdp0 } : {}), isError: false, ...extra });
    };
    let result: any;
    try {
      result = await tool.execute(...args);
    } catch (error) {
      await record({ isError: true, error: errorCode(error, args[2]) }, performance.now()).catch(() => {});
      throw error;
    }
    const end = performance.now();
    try {
      const text = (result.content as { type: string; text?: string }[]).map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("");
      const url = redactUrl(result.details?.url);
      await record({ ...describeResult(text), ...(url ? { url } : {}) }, end);
    } catch {
      // Tracing must never turn a finished tool call into a failure.
    }
    return result;
  };

  const traced = new Proxy(pi, {
    get(target, prop) {
      if (prop === "registerTool") return (tool: AnyTool) => target.registerTool(tool.name.startsWith("browser_") ? ({ ...tool, execute: (...args: any[]) => run(tool, args) } as never) : (tool as never));
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { pi: traced, askApproval };
}
