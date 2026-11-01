/**
 * OS user-presence check before a saved login is used. The first fill after launch (or after the unlock expires,
 * or the machine wakes from sleep) asks the OS to confirm the owner is there; later fills reuse that unlock.
 * Pure: the OS prompt, the clock and the "can prompt" probe are injected.
 */
export type PresenceResult = { ok: true } | { ok: false; error: string };

export interface PresenceGateOptions {
  /** Whether the OS can confirm presence on this device (Touch ID sensor present). */
  canPrompt: () => boolean;
  /** Shows the OS prompt; rejects when the owner cancels or fails it. */
  prompt: () => Promise<void>;
  now: () => number;
  /** How long one confirmation stays valid. */
  ttlMs: number;
}

export const NOT_CONFIRMED = "Sign-in was not confirmed.";

export function createPresenceGate(opts: PresenceGateOptions) {
  let unlockedAt: number | null = null;
  let pending: Promise<PresenceResult> | null = null;
  return {
    /** Without a way to prompt the check is skipped (reported as "unavailable" in the vault status). */
    async ensure(): Promise<PresenceResult> {
      if (!opts.canPrompt()) return { ok: true };
      if (unlockedAt !== null && opts.now() - unlockedAt < opts.ttlMs) return { ok: true };
      // Concurrent fills share one prompt.
      pending ??= opts
        .prompt()
        .then<PresenceResult>(() => {
          unlockedAt = opts.now();
          return { ok: true };
        })
        .catch<PresenceResult>(() => ({ ok: false, error: NOT_CONFIRMED }))
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    lock() {
      unlockedAt = null;
    },
  };
}
