import type { ManagedPolicy } from "@pista/protocol";
import { isRecord, SECRET_WORDS } from "./secrets.ts";

type AuditPolicy = NonNullable<ManagedPolicy["audit"]>;


function stringMap(raw: unknown, name: string, problems: string[]): Record<string, string> | undefined {
  if (!isRecord(raw)) {
    problems.push(`audit.${name} must be an object of strings`);
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (name === "headersEnv" && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k)) problems.push(`audit.headersEnv.${k} is not a valid HTTP header name`);
    else if (typeof v === "string" && v) out[k] = v;
    else problems.push(`audit.${name}.${k} must be a non-empty string`);
  }
  return out;
}

/** Parses the policy's `audit` block. Problems fail the policy load, like the network block. */
export function auditSection(raw: unknown, problems: string[], warnings: string[] = []): AuditPolicy {
  const out: AuditPolicy = { otlpEndpoint: "" };
  if (!isRecord(raw)) {
    problems.push('"audit" must be an object');
    return out;
  }
  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case "otlpEndpoint":
        try {
          const url = new URL(String(value));
          if (typeof value !== "string" || (url.protocol !== "http:" && url.protocol !== "https:")) throw new Error();
          if (url.username || url.password) problems.push("audit.otlpEndpoint must not contain credentials (user:pass@); use headersEnv");
          else out.otlpEndpoint = value;
        } catch {
          problems.push("audit.otlpEndpoint must be an http(s) URL");
        }
        break;
      case "protocol":
        if (value === "http") out.protocol = "http";
        else problems.push(`audit.protocol must be "http" (OTLP/HTTP JSON); ${value === "grpc" ? "grpc is not supported" : "unknown protocol"}`);
        break;
      case "includePrompts":
      case "includeToolArgs":
        if (typeof value === "boolean") out[key] = value;
        else problems.push(`audit.${key} must be a boolean`);
        break;
      case "headersEnv":
      case "resourceAttributes": {
        const map = stringMap(value, key, problems);
        if (map) out[key] = map;
        break;
      }
      default:
        problems.push(`audit.${key}: unknown setting`);
    }
  }
  if (out.otlpEndpoint && out.headersEnv && Object.keys(out.headersEnv).length) {
    const url = new URL(out.otlpEndpoint);
    if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) warnings.push(`audit.otlpEndpoint (${url.origin}) is plain http but headersEnv is set: the header values travel unencrypted`);
  }
  if (!out.otlpEndpoint && !problems.some((p) => p.startsWith("audit.otlpEndpoint"))) problems.push("audit.otlpEndpoint is required");
  return out;
}

/** Header name → value for the configured headers; a header whose variable is unset is left out and reported once. */
export function resolveAuditHeaders(headersEnv: Record<string, string> | undefined, env: NodeJS.ProcessEnv, warn: (message: string) => void): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, variable] of Object.entries(headersEnv ?? {})) {
    const value = env[variable];
    if (value) headers[name] = value;
    else warn(`audit.headersEnv.${name}: environment variable ${variable} is not set, header omitted`);
  }
  return headers;
}

/** The collector URL for logs: any trailing `/v1/logs` or `/` is replaced by `/v1/logs`; the query is kept and the fragment dropped. */
export function auditLogsUrl(endpoint: string): URL {
  const url = new URL(endpoint);
  url.hash = "";
  url.pathname = `${url.pathname.replace(/\/v1\/logs\/?$/, "").replace(/\/+$/, "")}/v1/logs`;
  return url;
}

const SECRET_NAME = new RegExp(SECRET_WORDS, "i");
/** Values to blank out of recorded text: env vars named like secrets plus those the audit headers come from. Computed once. */
export function secretValues(env: NodeJS.ProcessEnv, headersEnv?: Record<string, string>): string[] {
  const names = new Set([...Object.keys(env).filter((n) => SECRET_NAME.test(n)), ...Object.values(headersEnv ?? {})]);
  return [...names].map((n) => env[n]).filter((v): v is string => !!v && v.length >= 8);
}
