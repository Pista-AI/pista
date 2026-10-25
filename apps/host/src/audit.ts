// Audit export: OTLP/HTTP JSON logs to the admin's collector, configured by the managed policy's `audit` block.
// Built by hand (no dependency); `fetch` goes through the global undici dispatcher that policy-boot.ts installs
// (proxy and CA), so the policy-boot import in index.ts must stay before this module is used.
import { createHash } from "node:crypto";
import { hostname, type } from "node:os";
import type { ManagedPolicy } from "@pista/protocol";
import { auditLogsUrl, resolveAuditHeaders, secretValues } from "./audit-policy.ts";

export type AuditAttrs = Record<string, string | number | boolean | undefined>;

/** Where audit events go. Event names are `pista.<area>.<action>`; attribute keys are dotted lowercase. */
export interface AuditSink {
  emit(name: string, attrs: AuditAttrs, opts?: { body?: string }): void;
  /** Sends what is queued. Never rejects. */
  flush(): Promise<void>;
  /** Flushes and stops the timer. */
  dispose(): Promise<void>;
  /** Whether prompts and tool arguments may be put in events (policy opt-ins, both off by default). */
  readonly includePrompts: boolean;
  readonly includeToolArgs: boolean;
  /** Env var names behind the policy's audit headers; their values are never recorded. */
  readonly headersEnv?: Record<string, string>;
  /** Secret values (from the environment, read at creation) to redact from recorded text. */
  readonly secrets: string[];
}

export const noopAudit: AuditSink = {
  emit() {},
  flush: async () => {},
  dispose: async () => {},
  includePrompts: false,
  includeToolArgs: false,
  secrets: [],
};

/** Short stable hash, so events can be correlated without carrying a path. */
export const auditHash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 16);

const BATCH = 50;
const MAX_QUEUE = 1000;
const INTERVAL_MS = 5000;
const TIMEOUT_MS = 5000;

type AnyValue = { stringValue: string } | { boolValue: boolean } | { intValue: string } | { doubleValue: number };
const anyValue = (v: string | number | boolean): AnyValue =>
  typeof v === "string" ? { stringValue: v } : typeof v === "boolean" ? { boolValue: v } : Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
const keyValues = (attrs: AuditAttrs) => Object.entries(attrs).flatMap(([key, v]) => (v === undefined ? [] : [{ key, value: anyValue(v) }]));

export interface OtlpSinkOptions {
  policy: NonNullable<ManagedPolicy["audit"]>;
  version: string;
  env?: NodeJS.ProcessEnv;
  /** Current signed-in user (OIDC subject); read per record because it can change at runtime. With several SSO providers signed in, which one is reported is arbitrary. */
  subject?: () => string | undefined;
  warn?: (message: string) => void;
  intervalMs?: number;
}

export function createOtlpAudit(opts: OtlpSinkOptions): AuditSink {
  const { policy } = opts;
  const warn = opts.warn ?? ((m) => console.warn(`[pista-host] ${m}`));
  const headers = resolveAuditHeaders(policy.headersEnv, opts.env ?? process.env, warn);
  const target = auditLogsUrl(policy.otlpEndpoint);
  const origin = target.origin; // logged instead of the full URL, which may carry a query token
  const resource = keyValues({ "service.name": "pista", "service.version": opts.version, "host.name": hostname(), "os.type": type(), ...policy.resourceAttributes });
  let queue: object[] = [];
  let dropped = 0;
  let inflight: Promise<void> = Promise.resolve();
  let pending = 0; // records handed to send() and not yet finished; they count toward MAX_QUEUE
  let disposed = false;
  let warned = false;

  const send = async (records: object[]) => {
    try {
      const response = await fetch(target, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ resourceLogs: [{ resource: { attributes: resource }, scopeLogs: [{ scope: { name: "pista.audit" }, logRecords: records }] }] }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      dropped += records.length;
      if (!warned) {
        warned = true;
        warn(`audit export to ${origin} failed (${(error as Error).name === "TimeoutError" ? "timeout" : (error as Error).message}); records are dropped (counted), further failures are not logged`);
      }
    }
  };

  const flush = (): Promise<void> => {
    if (queue.length === 0) return inflight;
    const records = queue;
    queue = [];
    pending += records.length;
    inflight = inflight.then(() => send(records)).finally(() => (pending -= records.length));
    return inflight;
  };

  const timer = setInterval(() => void flush(), opts.intervalMs ?? INTERVAL_MS);
  timer.unref();

  return {
    includePrompts: policy.includePrompts === true,
    includeToolArgs: policy.includeToolArgs === true,
    ...(policy.headersEnv ? { headersEnv: policy.headersEnv } : {}),
    secrets: secretValues(opts.env ?? process.env, policy.headersEnv),
    emit(name, attrs, emitOpts) {
      try {
        if (disposed) return;
        if (queue.length + pending >= MAX_QUEUE) {
          dropped++;
          return;
        }
        const subject = opts.subject?.();
        queue.push({
          timeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
          severityNumber: 9,
          severityText: "INFO",
          ...(emitOpts?.body !== undefined ? { body: { stringValue: emitOpts.body } } : {}),
          attributes: keyValues({ "event.name": name, ...(subject ? { "enduser.id": subject } : {}), ...attrs }),
        });
        if (queue.length >= BATCH) void flush();
      } catch {
        dropped++;
      }
    },
    flush,
    async dispose() {
      disposed = true;
      clearInterval(timer);
      await flush();
      if (dropped > 0) warn(`audit export: ${dropped} record(s) dropped`);
    },
  };
}

/** The sink for the loaded policy: OTLP when it has an `audit` block, otherwise a no-op that sends nothing. */
export function createAudit(policy: ManagedPolicy | null | undefined, opts: Omit<OtlpSinkOptions, "policy">): AuditSink {
  return policy?.audit ? createOtlpAudit({ ...opts, policy: policy.audit }) : noopAudit;
}
