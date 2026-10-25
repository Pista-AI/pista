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

const AZURE_CREDS = ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"];
const AZURE_VARS = ["AZURE_TRUSTED_SIGNING_ENDPOINT", "AZURE_TRUSTED_SIGNING_ACCOUNT", "AZURE_TRUSTED_SIGNING_PROFILE", "AZURE_TRUSTED_SIGNING_PUBLISHER"];

/**
 * Decide how the Windows build signs. Pure, so it can be unit tested.
 * "pfx" = electron-builder's WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD, "azure" = Azure Trusted Signing
 * (needs the four AZURE_TRUSTED_SIGNING_* values plus the AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET
 * credentials that Azure's SDK reads; `missing` lists names only), "none" = unsigned. A partial Azure set is an error, not a silent unsigned build.
 * @param {Record<string, string | undefined>} env
 * @returns {{ method: "none" | "pfx" | "azure", missing: string[] }}
 */
function winSigningPlan(env) {
  const set = (name) => typeof env[name] === "string" && env[name].trim() !== "";
  const azureSet = AZURE_VARS.filter(set);
  if (azureSet.length > 0) return { method: "azure", missing: [...AZURE_VARS, ...AZURE_CREDS].filter((n) => !set(n)) };
  if (set("WIN_CSC_LINK")) return { method: "pfx", missing: [] };
  return { method: "none", missing: [] };
}

module.exports = { signingPlan, describePlan, winSigningPlan, APPLE_VARS, AZURE_VARS, AZURE_CREDS };
