import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import type { HostConfig, ThinkingMode } from "@pista/protocol";
import { isLocalProvider } from "./local.ts";

/**
 * Inside a browsing tool sequence the planner only picks the next click, so sampling noise just costs wrong picks.
 * Requests that directly follow browser_* tool results are pinned to temperature 0. Thinking is left to the auto-thinking
 * judge: switching it off for these turns made small local models fail more tasks in testing, because they then
 * skip form steps and guess URLs.
 */

interface ChatPayload {
  messages?: ({ role?: string; tool_calls?: { function?: { name?: string } }[] } & Record<string, unknown>)[];
  temperature?: unknown;
}

/** The browser tool the latest assistant turn called, when the request ends with that turn's tool results; otherwise undefined. */
export function browserToolBeforeRequest(payload: unknown): string | undefined {
  const messages = (payload as ChatPayload | null)?.messages;
  if (!Array.isArray(messages)) return undefined; // not an OpenAI-shaped chat payload
  let i = messages.length - 1;
  while (i >= 0 && messages[i]?.role === "tool") i--;
  if (i === messages.length - 1) return undefined; // no tool results at the end: first call of a user message
  const names = (messages[i]?.role === "assistant" ? messages[i]!.tool_calls ?? [] : []).map((c) => c.function?.name ?? "");
  return names.filter((n) => n.startsWith("browser_")).at(-1);
}

/** The payload to send with temperature 0, or undefined to leave the request alone. The input is not mutated. */
export function quietPlannerPayload<T>(payload: T): T | undefined {
  if (!browserToolBeforeRequest(payload)) return undefined;
  return { ...payload, temperature: 0 };
}

export interface BrowsingTurnsDeps {
  config: Pick<HostConfig, "localServers">;
  /** The thread's thinking mode; only "auto" is adjusted, an explicit setting the user picked always stands. */
  thinkingMode: () => ThinkingMode | undefined;
}

export function browsingTurnsExtension(deps: BrowsingTurnsDeps): InlineExtension {
  return {
    name: "browsing-turns",
    factory: (pi: ExtensionAPI) => {
      let logged = false;
      pi.on("agent_start", () => {
        logged = false;
      });
      pi.on("before_provider_request", (event, ctx) => {
        const model = ctx.model;
        if (deps.thinkingMode() !== "auto" || !model || !isLocalProvider(model.provider, model.baseUrl, deps.config)) return undefined;
        const tool = browserToolBeforeRequest(event.payload);
        if (!tool) {
          logged = false; // a new sequence starts after the next browser-free request
          return undefined;
        }
        if (!logged) {
          logged = true;
          console.log(`[browsing-turns] temp 0 (after ${tool})`);
        }
        return quietPlannerPayload(event.payload);
      });
    },
  };
}
