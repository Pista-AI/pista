import { validSliced } from "./sliced/validate.ts";

// policy.ts imports this map, never the registry: the registry reaches session.ts, whose module-level code reads the real ~/.pista when imported before setupHome() (fails with an empty HOME).
/** Config validators by harness id, for the managed policy. Keep in step with the built-in harnesses' `validateConfig`. */
export const HARNESS_CONFIG_VALIDATORS: Record<string, (raw: unknown) => boolean> = { sliced: validSliced };
