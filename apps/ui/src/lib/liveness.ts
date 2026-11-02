export const PING_EVERY_MS = 15_000;
export const STALE_AFTER_MS = 40_000;

/**
 * Browsers cannot see protocol pings, so an idle socket gives no sign it died (sleep, network blip).
 * Every interval we ask the host for a reply; if nothing at all arrived for `staleMs`, `onStale` fires
 * once and the watch stops. Call `touch` on every incoming message.
 */
export function watchLiveness(opts: { ping: () => void; onStale: () => void; pingMs?: number; staleMs?: number }) {
  const { ping, onStale, pingMs = PING_EVERY_MS, staleMs = STALE_AFTER_MS } = opts;
  let last = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - last >= staleMs) {
      clearInterval(timer);
      onStale();
      return;
    }
    ping();
  }, pingMs);
  return {
    touch: () => void (last = Date.now()),
    stop: () => clearInterval(timer),
  };
}
