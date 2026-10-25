import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ManagedPolicy } from "@pista/protocol";
import { oidcOAuth, type SsoOptions } from "./policy-sso.ts";

type RegisterProvider = ModelRuntime["registerProvider"];

const DEFAULT_CONTEXT = 128_000;
const MAX_OUTPUT = 16_384;

/** Environment variables a Pi config value references. Mirrors Pi's grammar: `$$` and `$!` are escapes, `${NAME}` and `$NAME` are references. */
function envRefs(value: string): string[] {
  const names: string[] = [];
  for (const match of value.matchAll(/\$(?:\$|!|\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g)) {
    const name = match[1] ?? match[2];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Registers the gateways a managed policy declares, the same way nebius.ts registers its provider.
 * The key stays an environment reference (`$NAME`); the host never reads or logs it.
 * `registeredIds` are the providers that already exist; a gateway with one of those ids is skipped. A failing registration never throws.
 * Returns warnings for the caller to log.
 */
export function registerPolicyGateways(
  policy: ManagedPolicy | null,
  env: NodeJS.ProcessEnv,
  registerProvider: RegisterProvider,
  registeredIds: Iterable<string> = [],
  sso: { fetch?: typeof fetch; options?: SsoOptions } = {},
): { registered: number; warnings: string[] } {
  const warnings: string[] = [];
  const taken = new Set(registeredIds);
  let registered = 0;
  for (const gateway of policy?.providers?.gateways ?? []) {
    if (taken.has(gateway.id)) {
      warnings.push(`gateway ${gateway.id}: a provider with this id is already registered, gateway ignored`);
      continue;
    }
    // Policy validation already drops a gateway with both; this guards callers that build a policy by hand.
    if (gateway.auth && gateway.apiKeyEnv) warnings.push(`gateway ${gateway.id}: both "auth" and "apiKeyEnv" are set, ${gateway.apiKeyEnv} is ignored and employees sign in with SSO`);
    else if (gateway.apiKeyEnv && !env[gateway.apiKeyEnv]) warnings.push(`gateway ${gateway.id}: ${gateway.apiKeyEnv} is not set, its models stay unavailable until it is`);
    for (const value of Object.values(gateway.headers ?? {})) {
      for (const name of envRefs(value)) if (!env[name]) warnings.push(`gateway ${gateway.id}: header variable ${name} is not set`);
    }
    const api = gateway.kind === "anthropic-compatible" ? "anthropic-messages" : "openai-completions";
    try {
      registerProvider(gateway.id, {
        name: gateway.name,
        baseUrl: gateway.baseUrl,
        api,
        ...(gateway.auth
          // SSO: Pi stores and refreshes the token; an `apiKey` next to `oauth` would add an api_key login. An anthropic-compatible gateway gets the token as `Authorization: Bearer`.
          ? { oauth: oidcOAuth(gateway, sso.fetch, sso.options), ...(gateway.kind === "anthropic-compatible" ? { authHeader: true } : {}) }
          // Pi treats a provider without a key as unconfigured; with no apiKeyEnv the gateway authenticates through its headers.
          : { apiKey: gateway.apiKeyEnv ? `$${gateway.apiKeyEnv}` : "gateway" }),
        ...(gateway.headers ? { headers: gateway.headers } : {}),
        models: gateway.models.map((m) => {
          const contextWindow = m.contextWindow ?? DEFAULT_CONTEXT;
          return {
            id: m.id,
            name: m.name ?? m.id,
            api,
            reasoning: m.reasoning ?? false,
            input: ["text"] as ("text" | "image")[],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow,
            maxTokens: m.maxTokens ?? Math.min(MAX_OUTPUT, Math.floor(contextWindow / 4)),
            // A gateway in front of arbitrary models may reject OpenAI's "developer" role.
            ...(gateway.kind === "openai-compatible" ? { compat: { supportsDeveloperRole: false } } : {}),
          };
        }),
      });
      taken.add(gateway.id);
      registered++;
    } catch (error) {
      warnings.push(`gateway ${gateway.id}: registration failed (${(error as Error).message}), gateway ignored`);
    }
  }
  return { registered, warnings };
}
