import type { PolicyGateway } from "@pista/protocol";

/**
 * Sign-in with the organisation's OIDC identity provider for a policy gateway: the OAuth 2.0 device
 * authorization grant (RFC 8628) with a public client. The result is the `oauth` block Pi's
 * `registerProvider` takes; Pi stores the credential in auth.json and refreshes it before expiry.
 * The only outbound calls go to the endpoints the IdP's discovery document names. Tokens are never logged.
 */

export const DEFAULT_OIDC_SCOPES = ["openid", "offline_access"];

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_INTERVAL_S = 5;
const MAX_DEVICE_LIFETIME_S = 900;
const MIN_INTERVAL_S = 1;
const MAX_BODY_BYTES = 256 * 1024;
/** Consecutive transport failures or 5xx answers tolerated (retried) while polling; one more abandons the sign-in. */
const POLL_FAILURE_BUDGET = 3;
const DEFAULT_TOKEN_LIFETIME_S = 3600;
const SLOW_DOWN_MS = 5000;

type OidcAuth = NonNullable<PolicyGateway["auth"]>;
type Fetch = typeof fetch;
type Json = Record<string, unknown>;

/** What Pi stores for the gateway; `access` is the bearer (the access or the ID token). */
export interface SsoCredentials {
  access: string;
  refresh: string;
  /** Epoch milliseconds, already shortened by a lead time. */
  expires: number;
  issuer: string;
  clientId: string;
  tokenEndpoint: string;
  tokenKind: "id" | "access";
  subject?: string;
  [key: string]: unknown;
}

interface Callbacks {
  onDeviceCode(info: { userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }): void;
  onProgress?(message: string): void;
  signal?: AbortSignal;
}

/** Test seams: the real values come from the IdP. */
export interface SsoOptions {
  /** Replaces the polling interval (ms). */
  pollMs?: number;
  /** Added to the interval on `slow_down` (ms). Default 5000. */
  slowDownMs?: number;
  /** Per-request timeout (ms). Default 15000. */
  timeoutMs?: number;
}

const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : typeof v === "string" && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : undefined);

const isLoopback = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

/** https; plain http only when the issuer itself is a loopback host and so is the endpoint (test IdPs; policy validation requires an https issuer). */
function checkEndpoint(value: unknown, what: string, issuer: string): string {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error(`The identity provider returned an invalid ${what}`);
  }
  const plainOk = url.protocol === "http:" && isLoopback(url.hostname) && isLoopback(new URL(issuer).hostname);
  if (url.protocol !== "https:" && !plainOk) throw new Error(`The identity provider's ${what} must use https`);
  return url.toString();
}

/** A request that failed in transit (network, timeout, truncated body); polling and refresh treat it as transient. */
class TransportError extends Error {}

/** An IdP error text with anything token-shaped removed and the length capped. */
function redact(text: string): string {
  return text.replace(/[A-Za-z0-9_~+/=-]{24,}(?:\.[A-Za-z0-9_~+/=-]{4,})*/g, "[redacted]").slice(0, 200);
}

function describeIdpError(body: Json | undefined, status: number): string {
  const code = str(body?.error);
  const description = str(body?.error_description);
  return code ? `${redact(code)}${description ? `: ${redact(description)}` : ""}` : `HTTP ${status}`;
}

/** Decodes a JWT payload without verifying it; the host only reads `sub` and `exp` for display and expiry. */
function jwtClaims(token: string | undefined): Json | undefined {
  const part = token?.split(".")[1];
  if (!part) return undefined;
  try {
    const claims: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return isRecord(claims) ? claims : undefined;
  } catch {
    return undefined;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Login cancelled"));
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      done();
      reject(new Error("Login cancelled"));
    };
    const timer = setTimeout(() => {
      done();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function oidcOAuth(gateway: PolicyGateway, fetchImpl: Fetch = fetch, options: SsoOptions = {}) {
  const auth = gateway.auth as OidcAuth;
  const tokenKind = auth.token ?? "access";
  const scopes = [...new Set([...DEFAULT_OIDC_SCOPES, ...(auth.scopes ?? [])])];

  /** Reads a JSON object body, giving up past MAX_BODY_BYTES. */
  async function readBody(response: Response): Promise<Json | undefined> {
    const declared = Number(response.headers.get("content-length"));
    if (declared > MAX_BODY_BYTES) throw new Error("The identity provider's response is too large");
    const reader = response.body?.getReader();
    if (!reader) return undefined;
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new Error("The identity provider's response is too large");
      }
      chunks.push(value);
    }
    try {
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async function request(url: string, init: RequestInit, signal?: AbortSignal): Promise<{ status: number; body: Json | undefined }> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, { ...init, redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      return { status: response.status, body: await readBody(response) };
    } catch (error) {
      if (signal?.aborted) throw new Error("Login cancelled");
      if (error instanceof Error && /too large/.test(error.message)) throw error;
      throw new TransportError(`Could not reach the identity provider (${timeout.aborted ? "timed out" : redact((error as Error).message)})`);
    }
  }

  const form = (url: string, params: Record<string, string>, signal?: AbortSignal) =>
    request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(params).toString() }, signal);

  async function discover(signal?: AbortSignal): Promise<{ deviceEndpoint: string; tokenEndpoint: string }> {
    const url = `${auth.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
    const { status, body } = await request(checkEndpoint(url, "issuer", auth.issuer), { headers: { accept: "application/json" } }, signal);
    if (status !== 200 || !body) throw new Error(`The identity provider's discovery document could not be read (${describeIdpError(body, status)})`);
    if (str(body.issuer) !== auth.issuer) throw new Error("The identity provider's discovery document names a different issuer than the policy");
    const device = str(body.device_authorization_endpoint);
    const token = str(body.token_endpoint);
    if (!device) throw new Error("The identity provider does not offer the device authorization grant (no device_authorization_endpoint)");
    if (!token) throw new Error("The identity provider's discovery document has no token_endpoint");
    return { deviceEndpoint: checkEndpoint(device, "device_authorization_endpoint", auth.issuer), tokenEndpoint: checkEndpoint(token, "token_endpoint", auth.issuer) };
  }

  /** Builds the stored credential from a token response; `previous` (a refresh) supplies what the response may omit. */
  function credentialFrom(body: Json, tokenEndpoint: string, previous?: SsoCredentials): SsoCredentials {
    const idToken = str(body.id_token);
    const access = tokenKind === "id" ? idToken : str(body.access_token);
    if (!access) {
      if (tokenKind === "id" && previous) throw new Error(`The identity provider returned no ID token on refresh; sign in again to ${gateway.name}`);
      throw new Error(tokenKind === "id" ? 'The identity provider returned no ID token; add the "openid" scope or set token to "access"' : "The identity provider returned no access token");
    }
    const now = Date.now();
    // The bearer's own `exp` (when it is a JWT) is authoritative, even when already past: Pi then refreshes at once.
    const exp = jwtClaims(access)?.exp;
    const expiresAt = typeof exp === "number" ? exp * 1000 : now + (num(body.expires_in) ?? DEFAULT_TOKEN_LIFETIME_S) * 1000;
    const lead = Math.max(0, Math.min(60_000, Math.floor((expiresAt - now) / 10)));
    const subject = str(jwtClaims(idToken)?.sub) ?? previous?.subject;
    return {
      access,
      refresh: str(body.refresh_token) ?? previous?.refresh ?? "",
      expires: expiresAt - lead,
      issuer: auth.issuer,
      clientId: auth.clientId,
      tokenEndpoint,
      tokenKind,
      ...(subject ? { subject } : {}),
    };
  }

  /** The stored sign-in belongs to another IdP or client than the policy names now; it must not be used or refreshed. */
  function assertSameIdp(cred: Partial<SsoCredentials>) {
    if (cred.issuer !== auth.issuer || cred.clientId !== auth.clientId) throw new Error(`Sign in again to ${gateway.name}: the policy now names a different identity provider`);
  }

  return {
    name: gateway.name,

    async login(cb: Callbacks): Promise<SsoCredentials> {
      const { signal } = cb;
      const { deviceEndpoint, tokenEndpoint } = await discover(signal);
      const started = await form(deviceEndpoint, { client_id: auth.clientId, scope: scopes.join(" "), ...(auth.audience ? { audience: auth.audience } : {}) }, signal);
      const deviceCode = str(started.body?.device_code);
      const userCode = str(started.body?.user_code);
      const verification = str(started.body?.verification_uri_complete) ?? str(started.body?.verification_uri) ?? str(started.body?.verification_url);
      if (started.status !== 200 || !deviceCode || !userCode || !verification) throw new Error(`Sign-in could not start (${describeIdpError(started.body, started.status)})`);
      const lifetimeS = Math.min(num(started.body?.expires_in) ?? MAX_DEVICE_LIFETIME_S, MAX_DEVICE_LIFETIME_S);
      const advertised = Number(started.body?.interval);
      const intervalS = Math.max(MIN_INTERVAL_S, Number.isFinite(advertised) && started.body?.interval !== null && started.body?.interval !== undefined ? advertised : DEFAULT_INTERVAL_S);
      cb.onDeviceCode({ userCode, verificationUri: checkEndpoint(verification, "verification URI", auth.issuer), intervalSeconds: intervalS, expiresInSeconds: lifetimeS });

      const deadline = Date.now() + lifetimeS * 1000;
      let waitMs = options.pollMs ?? intervalS * 1000;
      let failures = 0;
      for (;;) {
        await sleep(waitMs, signal);
        if (Date.now() > deadline) throw new Error("The sign-in code expired; start again");
        let reply: { status: number; body: Json | undefined };
        try {
          reply = await form(tokenEndpoint, { grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: auth.clientId }, signal);
        } catch (error) {
          if (!(error instanceof TransportError) || ++failures > POLL_FAILURE_BUDGET) throw error;
          continue;
        }
        const { status, body } = reply;
        if (status === 200 && body) return credentialFrom(body, tokenEndpoint);
        // A 5xx without an OAuth error is the IdP (or a proxy) stumbling, not an answer.
        if (status >= 500 && !str(body?.error)) {
          if (++failures > POLL_FAILURE_BUDGET) throw new Error(`Sign-in failed (${describeIdpError(body, status)})`);
          continue;
        }
        failures = 0;
        switch (str(body?.error)) {
          case "authorization_pending":
            break;
          case "slow_down":
            waitMs += options.slowDownMs ?? SLOW_DOWN_MS;
            break;
          case "expired_token":
            throw new Error("The sign-in code expired; start again");
          case "access_denied":
            throw new Error("Sign-in was denied at the identity provider");
          default:
            throw new Error(`Sign-in failed (${describeIdpError(body, status)})`);
        }
      }
    },

    async refreshToken(credentials: Record<string, unknown>, signal: AbortSignal): Promise<SsoCredentials> {
      const cred = credentials as Partial<SsoCredentials>;
      assertSameIdp(cred);
      if (!cred.refresh || !cred.tokenEndpoint) throw new Error(`Sign in again to ${gateway.name}: the stored sign-in has no refresh token (does the IdP app allow offline_access?)`);
      let reply: { status: number; body: Json | undefined };
      try {
        reply = await form(checkEndpoint(cred.tokenEndpoint, "token_endpoint", auth.issuer), { grant_type: "refresh_token", refresh_token: cred.refresh, client_id: auth.clientId, scope: scopes.join(" ") }, signal);
      } catch (error) {
        // Pi refreshes five minutes early: if the IdP is unreachable and the token still lives, let the request go ahead with it.
        if (error instanceof TransportError && typeof cred.expires === "number" && cred.expires > Date.now()) return cred as SsoCredentials;
        throw error;
      }
      const { status, body } = reply;
      if (status === 200 && body) return credentialFrom(body, cred.tokenEndpoint, cred as SsoCredentials);
      if (str(body?.error) === "invalid_grant") throw new Error(`Sign in again to ${gateway.name}: the identity provider no longer accepts the stored sign-in`);
      if (status >= 500 && !str(body?.error) && typeof cred.expires === "number" && cred.expires > Date.now()) return cred as SsoCredentials;
      throw new Error(`Refreshing the ${gateway.name} sign-in failed (${describeIdpError(body, status)})`);
    },

    getApiKey(credentials: Record<string, unknown>) {
      assertSameIdp(credentials as Partial<SsoCredentials>);
      return String(credentials.access ?? "");
    },
  };
}
