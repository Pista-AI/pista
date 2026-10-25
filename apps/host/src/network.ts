import { readFileSync } from "node:fs";
import tls from "node:tls";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import type { ManagedPolicy } from "@pista/protocol";

export type NetworkPolicy = NonNullable<ManagedPolicy["network"]>;

/** Replaces any userinfo of the URL (in place) with `***`; the one place URL credentials are masked. */
export function maskUserinfo(url: URL): URL {
  if (url.username || url.password) {
    url.username = "***";
    url.password = "";
  }
  return url;
}

/** The proxy URL with any userinfo replaced, safe to log. An unparsable value is not echoed. */
export function redactProxy(raw: string): string {
  try {
    const url = maskUserinfo(new URL(raw));
    return url.toString().replace(/\/$/, "");
  } catch {
    return "<invalid proxy URL>";
  }
}

/** Loopback is always direct: local model servers (LM Studio, Ollama, llama-server) must never be sent to a corporate proxy. */
const LOOPBACK = ["127.0.0.1", "localhost", "::1", "[::1]"];
const withLoopback = (list: string | null | undefined) => [...new Set([...(list ? list.split(",").map((x) => x.trim()).filter(Boolean) : []), ...LOOPBACK])].join(",");

const first = (env: NodeJS.ProcessEnv, ...names: string[]) => names.map((n) => env[n]).find((v) => v);

export interface AppliedNetwork {
  proxy: string | null;
  noProxy: string;
  caFiles: number;
  systemCa: boolean;
}

/**
 * Applies the proxy and CA settings for every outbound request of the host: installs a global undici
 * dispatcher (which fetch, the provider SDKs and the MCP HTTP transports use) and writes the proxy into the
 * environment for libraries that read it there. Policy wins over the standard variables. Throws when a CA file is unreadable.
 */
export function applyNetwork(policy: NetworkPolicy | undefined, env: NodeJS.ProcessEnv = process.env): AppliedNetwork {
  const proxy = policy?.proxy ?? first(env, "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy") ?? null;
  const noProxy = withLoopback(policy?.noProxy ? policy.noProxy.join(",") : first(env, "NO_PROXY", "no_proxy"));
  if (policy?.proxy) {
    for (const name of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) delete env[name];
    env.HTTPS_PROXY = env.HTTP_PROXY = policy.proxy;
  }
  delete env.no_proxy;
  env.NO_PROXY = noProxy;
  const extra = (policy?.caCertFiles ?? []).map((file) => {
    try {
      return readFileSync(file, "utf8");
    } catch (error) {
      throw new Error(`network.caCertFiles: cannot read ${file} (${(error as Error).message})`);
    }
  });
  const systemCa = policy?.useSystemCa === true;
  let ca: string[] | undefined;
  if (extra.length > 0 || systemCa) {
    const base = systemCa && typeof tls.getCACertificates === "function" ? tls.getCACertificates("system") : tls.rootCertificates;
    const merged = [...new Set([...base, ...extra])];
    // Prefer the process-wide default so libraries that bypass the dispatcher (node:https, AWS SDK) trust it too.
    if (typeof tls.setDefaultCACertificates === "function") tls.setDefaultCACertificates([...new Set([...tls.getCACertificates("default"), ...merged])]);
    else {
      ca = merged;
      console.warn("[pista-host] network: this Node cannot extend the default CA list, so extra CAs apply to fetch traffic only; node:https clients (Bedrock) need NODE_EXTRA_CA_CERTS set by the launcher");
    }
  }
  // Built even without a proxy: with none configured it connects directly, so there is one code path.
  setGlobalDispatcher(
    new EnvHttpProxyAgent({
      ...(proxy ? { httpProxy: first(env, "HTTP_PROXY", "http_proxy") ?? proxy, httpsProxy: first(env, "HTTPS_PROXY", "https_proxy") ?? proxy } : {}),
      noProxy,
      ...(ca ? { connect: { ca }, proxyTls: { ca } } : {}),
    }),
  );
  return { proxy, noProxy, caFiles: extra.length, systemCa };
}

export function describeNetwork(applied: AppliedNetwork): string {
  const parts = [applied.proxy ? `proxy ${redactProxy(applied.proxy)}` : "", applied.noProxy !== withLoopback(null) ? `no-proxy ${applied.noProxy}` : "", applied.caFiles ? `${applied.caFiles} extra CA file(s)` : "", applied.systemCa ? "system CA store" : ""].filter(Boolean);
  return parts.length ? `[pista-host] network: ${parts.join(", ")}` : "";
}

/** Environment values that switch off Pi's telemetry and version check, for the keys the policy sets to false. */
export function telemetryEnv(policy: ManagedPolicy["telemetry"]): Record<string, string> {
  return { ...(policy?.piTelemetry === false ? { PI_TELEMETRY: "0" } : {}), ...(policy?.versionCheck === false ? { PI_SKIP_VERSION_CHECK: "1" } : {}) };
}
