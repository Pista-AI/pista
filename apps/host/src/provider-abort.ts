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
 * True for a reply that failed with an AbortError the host did not cause. When the run's own signal aborts
 * (Stop, the sub-agent timeout, the loop guard), Pi records stopReason "aborted"; stopReason "error" with an
 * abort text means the provider ended the stream itself, e.g. an OpenAI-compatible server relaying its own
 * upstream abort as an in-stream error event.
 */
export function isProviderAbort(message: Message): boolean {
  return message.role === "assistant" && message.stopReason === "error" && !!message.errorMessage && ABORT_TEXT.test(message.errorMessage) && !message.errorMessage.startsWith(INTERRUPTED_PREFIX);
}

/**
 * Lets Pi's built-in auto-retry (bounded attempts with backoff, cancelled by Stop) retry a provider-side abort.
 * Pi's classifier does not list abort texts, so without this one dropped stream ends the whole run.
 */
export function providerAbortRetryExtension(): InlineExtension {
  return {
    name: "provider-abort-retry",
    factory: (pi: ExtensionAPI) => {
      pi.on("message_end", (event) => {
        const message = event.message as Message;
        if (!isProviderAbort(message)) return undefined;
        return { message: { ...event.message, errorMessage: `${INTERRUPTED_PREFIX}: ${message.errorMessage}` } as typeof event.message };
      });
    },
  };
}
