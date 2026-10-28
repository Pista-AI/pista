import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

/**
 * Labels a reply "aborted" when the run's own signal has aborted (Stop, the loop guard, the sub-agent timeout).
 * When the abort lands between turns, Pi still starts the next request and its setup rejects with the signal's
 * AbortError; Pi labels every setup failure stopReason "error", so a stop by the host would read as a provider error.
 */
export function abortLabelExtension(): InlineExtension {
  return {
    name: "abort-label",
    factory: (pi: ExtensionAPI) => {
      pi.on("message_end", (event, ctx) => {
        const message = event.message as { role: string; stopReason?: string };
        if (message.role !== "assistant" || message.stopReason !== "error" || !ctx.signal?.aborted) return undefined;
        return { message: { ...event.message, stopReason: "aborted" } as typeof event.message };
      });
    },
  };
}
