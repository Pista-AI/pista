// Decides from the environment whether the desktop build signs and notarizes.
// Kept separate from electron-builder.config.cjs so it can be unit tested and so the
// config module exports nothing but the config (electron-builder rejects extra keys).

const APPLE_VARS = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"];

/**
 * Decide what the build does from the environment. Pure, so it can be unit tested.
 * @param {Record<string, string | undefined>} env
 * @returns {{ sign: boolean, notarize: boolean, missing: string[] }}
 *   `missing` lists the Apple notarization variables that are unset while signing is on.
 */
function signingPlan(env) {
  const set = (name) => typeof env[name] === "string" && env[name].trim() !== "";
  const sign = set("CSC_LINK") || set("CSC_NAME");
  if (!sign) return { sign: false, notarize: false, missing: [] };
  const missing = APPLE_VARS.filter((name) => !set(name));
  return { sign: true, notarize: missing.length === 0, missing };
}

/** One-line summary for the build log. Starts with "WARNING:" when signing is on but notarization is off, so a release cannot ship un-notarized unnoticed. */
function describePlan(plan) {
  if (!plan.sign) return "Signing: off (set CSC_LINK or CSC_NAME to enable)";
  if (plan.notarize) return "Signing: on, notarization: on";
  return `WARNING: Signing: on, notarization: OFF (missing ${plan.missing.join(", ")}); this build will not pass Gatekeeper on other Macs`;
}

module.exports = { signingPlan, describePlan, APPLE_VARS };
