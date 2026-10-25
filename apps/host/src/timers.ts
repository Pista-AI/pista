/** Largest delay Node timers accept (2^31-1 ms, about 24.8 days); anything above fires after 1 ms. */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/** Clamps a config-derived timer delay into what Node can schedule. */
export const clampTimerMs = (ms: number): number => Math.min(ms, MAX_TIMER_MS);
