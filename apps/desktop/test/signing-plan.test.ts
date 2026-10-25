import assert from "node:assert/strict";
import { test } from "node:test";
import { describePlan, signingPlan } from "../scripts/signing-plan.cjs";

const APPLE = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"];

test("nothing set: unsigned, no notarization", () => {
  const plan = signingPlan({});
  assert.deepEqual(plan, { sign: false, notarize: false, missing: [] });
  assert.equal(describePlan(plan), "Signing: off (set CSC_LINK or CSC_NAME to enable)");
});

test("Apple variables alone do not turn signing on", () => {
  const plan = signingPlan({ APPLE_ID: "a", APPLE_APP_SPECIFIC_PASSWORD: "b", APPLE_TEAM_ID: "c" });
  assert.deepEqual(plan, { sign: false, notarize: false, missing: [] });
});

test("empty or blank values count as unset", () => {
  assert.equal(signingPlan({ CSC_LINK: "", CSC_NAME: "  " }).sign, false);
});

test("CSC_LINK only: sign without notarizing and list the Apple variables", () => {
  const plan = signingPlan({ CSC_LINK: "base64", CSC_KEY_PASSWORD: "pw" });
  assert.deepEqual(plan, { sign: true, notarize: false, missing: APPLE });
  assert.equal(
    describePlan(plan),
    "WARNING: Signing: on, notarization: OFF (missing APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID); this build will not pass Gatekeeper on other Macs",
  );
});

test("CSC_LINK plus all Apple variables: sign and notarize", () => {
  const plan = signingPlan({
    CSC_LINK: "base64",
    APPLE_ID: "a",
    APPLE_APP_SPECIFIC_PASSWORD: "b",
    APPLE_TEAM_ID: "c",
  });
  assert.deepEqual(plan, { sign: true, notarize: true, missing: [] });
  assert.equal(describePlan(plan), "Signing: on, notarization: on");
});

test("CSC_NAME path signs too, and reports only the missing Apple variables", () => {
  const plan = signingPlan({ CSC_NAME: "Acme Inc (TEAM123)", APPLE_ID: "a" });
  assert.deepEqual(plan, {
    sign: true,
    notarize: false,
    missing: ["APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"],
  });
});

test("describePlan never includes secret values", () => {
  const plan = signingPlan({ CSC_LINK: "super-secret-p12", CSC_KEY_PASSWORD: "super-secret-pw", APPLE_ID: "me@x.com" });
  assert.ok(!/super-secret|me@x\.com/.test(describePlan(plan)));
});

test("windows: unsigned by default, pfx with WIN_CSC_LINK, azure needs all four values", async () => {
  const { winSigningPlan, AZURE_VARS, AZURE_CREDS } = await import("../scripts/signing-plan.cjs");
  assert.deepEqual(winSigningPlan({}), { method: "none", missing: [] });
  assert.deepEqual(winSigningPlan({ CSC_LINK: "mac-cert" }), { method: "none", missing: [] });
  assert.deepEqual(winSigningPlan({ WIN_CSC_LINK: "x" }), { method: "pfx", missing: [] });
  assert.deepEqual(winSigningPlan(Object.fromEntries([...AZURE_VARS, ...AZURE_CREDS].map((n) => [n, "v"]))), { method: "azure", missing: [] });
  assert.equal(winSigningPlan({ AZURE_TRUSTED_SIGNING_ACCOUNT: "a" }).missing.length, 6);
});
