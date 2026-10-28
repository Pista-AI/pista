import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

/** An AbortError's text: the DOMException's "This operation was aborted" or Node's "The operation was aborted". */
const ABORT_TEXT = /\b(?:this|the) operation was aborted\b/i;

/**
 * Prefix that marks a provider-side abort as a transient stream failure. Pi's auto-retry classifier
 * (pi-ai `isRetryableAssistantError`) retries messages matching "stream was interrupted"; the test pins that.
 */
export const INTERRUPTED_PREFIX = "Provider stream was interrupted";

type Message = { role: string; stopReason?: string; errorMessage?: string };

/**
 * True for a reply that failed with an abort text and stopReason "error". That is either a provider ending the
 * stream itself (an OpenAI-compatible server relaying its own upstream abort as an in-stream error event), or the
 * host aborting the run while Pi was still setting up the request: Pi labels a setup failure "error" even when it
 * is the run's own abort. `providerAbortRetryExtension` tells the two apart by the run signal.
 */
export function isProviderAbort(message: Message): boolean {
  return message.role === "assistant" && message.stopReason === "error" && !!message.errorMessage && ABORT_TEXT.test(message.errorMessage) && !message.errorMessage.startsWith(INTERRUPTED_PREFIX);
}

/**
 * Lets Pi's built-in auto-retry (bounded attempts with backoff, cancelled by Stop) retry a provider-side abort.
 * Pi's classifier does not list abort texts, so without this one dropped stream ends the whole run.
 * When the run's signal has aborted (Stop, the loop guard, the sub-agent timeout), the reply is relabelled
 * "aborted" instead, so a stop by the host is never reported as a provider failure.
 */
export function providerAbortRetryExtension(): InlineExtension {
  return {
    name: "provider-abort-retry",
    factory: (pi: ExtensionAPI) => {
      pi.on("message_end", (event, ctx) => {
        const message = event.message as Message;
        if (!isProviderAbort(message)) return undefined;
        if (ctx.signal?.aborted) return { message: { ...event.message, stopReason: "aborted" } as typeof event.message };
        return { message: { ...event.message, errorMessage: `${INTERRUPTED_PREFIX}: ${message.errorMessage}` } as typeof event.message };
      });
    },
  };
}
