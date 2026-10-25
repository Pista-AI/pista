import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { LOGIN_CANCELLED, type ManagedPolicy, type ModelInfo, type ProviderStatus } from "@pista/protocol";
import type { Hub } from "./hub.ts";
import { describeDenied, isDirectLoginAllowed, isModelAllowed, isProviderAllowed, isSsoGateway } from "./policy-access.ts";

/** Display names of signed-in SSO users, kept in memory because Pi does not expose stored credentials to the host. */
const subjects = new Map<string, string>();
/** One in-flight sign-in per provider; `auth.cancel` aborts it. */
const inflight = new Map<string, AbortController>();

/** Sign-ins aborted because a newer one started on the same provider (not by the user). */
const superseded = new WeakSet<AbortController>();

/** The signed-in SSO user's subject (OIDC `sub`), if any provider has one. */
export function currentSubject(): string | undefined {
  return subjects.values().next().value;
}

/** Forget the remembered signed-in user of a provider (call on sign-out). */
export function forgetSubject(provider: string): void {
  subjects.delete(provider);
}

/** Abort a running sign-in. A no-op when none is running. */
export function cancelLogin(provider: string): void {
  inflight.get(provider)?.abort();
}

export async function listModels(models: ModelRuntime, policy?: ManagedPolicy | null): Promise<ModelInfo[]> {
  const available = (await models.getAvailable()).filter((m) => isModelAllowed(policy, { provider: m.provider, id: m.id }));
  return available.map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name ?? m.id,
    reasoning: m.reasoning,
    contextWindow: m.contextWindow,
  }));
}

/** Providers the policy allows. When direct login is disabled they list no auth types (the UI renders no sign-in buttons), except policy SSO gateways, which keep their OAuth sign-in. */
export function listProviders(models: ModelRuntime, policy?: ManagedPolicy | null): ProviderStatus[] {
  const noLogin = !!policy?.providers?.disableDirectLogin;
  return models
    .getProviders()
    .filter((p) => isProviderAllowed(policy, p.id))
    .map((p) => {
      const sso = isSsoGateway(policy, p.id) && !!p.auth.oauth;
      const oauth = models.isUsingOAuth(p.id);
      const subject = oauth ? subjects.get(p.id) : undefined;
      return {
        id: p.id,
        name: p.name,
        configured: models.getProviderAuthStatus(p.id).configured,
        oauth,
        authTypes: sso ? ["oauth" as const] : noLogin ? [] : [p.auth.apiKey?.login ? ("api_key" as const) : null, p.auth.oauth ? ("oauth" as const) : null].filter(
          (t): t is "api_key" | "oauth" => t !== null,
        ),
        ...(sso ? { sso: true } : {}),
        ...(subject ? { subject } : {}),
      };
    })
    .sort((a, b) => Number(b.configured) - Number(a.configured) || a.name.localeCompare(b.name));
}

/**
 * Run a provider login, relaying prompts and notices (auth URLs, device codes)
 * to the UI. A supplied API key answers the first secret prompt directly.
 */
export async function login(
  models: ModelRuntime,
  hub: Hub,
  provider: string,
  type: "api_key" | "oauth",
  deviceId: string,
  apiKey?: string,
  policy?: ManagedPolicy | null,
): Promise<void> {
  if (!isDirectLoginAllowed(policy, provider, type)) {
    throw new Error(
      policy?.providers?.disableDirectLogin ? `Signing in to providers is disabled by your organisation's policy: ${provider}` : describeDenied(provider),
    );
  }
  let keyUsed = false;
  const previous = inflight.get(provider);
  if (previous) {
    superseded.add(previous);
    previous.abort();
  }
  const controller = new AbortController();
  inflight.set(provider, controller);
  const cancelled = new Promise<never>((_, reject) =>
    controller.signal.addEventListener("abort", () => reject(new Error(LOGIN_CANCELLED)), { once: true }),
  );
  cancelled.catch(() => {});
  let attempt: Promise<unknown> | undefined;
  try {
    attempt = models.login(provider, type, {
      signal: controller.signal,
      prompt: async (prompt) => {
        if (apiKey && !keyUsed && prompt.type === "secret") {
          keyUsed = true;
          return apiKey;
        }
        const value = await hub.ask<string | null>(
          (promptId) => ({ type: "auth.prompt", promptId, provider, prompt: { ...prompt, signal: undefined } }),
          10 * 60_000,
          prompt.signal,
        );
        if (value === null) throw new Error(LOGIN_CANCELLED);
        return value;
      },
      notify: (event) => {
        switch (event.type) {
          case "auth_url":
            hub.emit({ type: "auth.notice", provider, kind: "url", message: event.instructions ?? "Continue sign-in in your browser.", url: event.url });
            break;
          case "device_code":
            hub.emit({
              type: "auth.notice",
              provider,
              kind: "device_code",
              message: `Enter code ${event.userCode} to finish signing in.`,
              url: event.verificationUri,
              code: event.userCode,
              ...(event.expiresInSeconds ? { expiresAt: Date.now() + event.expiresInSeconds * 1000 } : {}),
            });
            break;
          default:
            hub.emit({ type: "auth.notice", provider, kind: "progress", message: event.message });
        }
      },
    }, { getDeviceId: () => deviceId });
    attempt.catch(() => {});
    const credential = await Promise.race([attempt, cancelled]);
    const subject = (credential as { subject?: unknown } | undefined)?.subject;
    if (typeof subject === "string" && subject) subjects.set(provider, subject);
    else subjects.delete(provider);
    hub.emit({ type: "auth.notice", provider, kind: "done", message: "Signed in.", done: true });
  } catch (error) {
    if (controller.signal.aborted && !superseded.has(controller)) {
      // Pi may finish and persist a credential just before or after the abort is seen. The UI says cancelled, so
      // sign out again once that late login resolves. A narrow window remains if Pi writes the credential after
      // logout has run; a sign-in abandoned by a newer attempt is left alone, its credential belongs to that attempt.
      void attempt?.then(() => models.logout(provider)).catch(() => {});
    }
    const message = controller.signal.aborted ? LOGIN_CANCELLED : (error as Error).message;
    hub.emit({ type: "auth.notice", provider, kind: "done", message: controller.signal.aborted ? "Sign-in cancelled." : "Sign-in failed.", done: true, error: message });
    throw controller.signal.aborted ? new Error(LOGIN_CANCELLED) : error;
  } finally {
    if (inflight.get(provider) === controller) inflight.delete(provider);
  }
}
