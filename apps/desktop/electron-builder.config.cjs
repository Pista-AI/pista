// electron-builder configuration, computed from the environment at load time.
//
// Signing is opt-in. With no credentials in the environment the build is ad-hoc
// signed exactly as before (local use only). Set CSC_LINK or CSC_NAME to produce a
// Developer ID signed, hardened-runtime build; add the three APPLE_* variables to
// also notarize it. See docs/release-signing.md. Secrets are read only by
// electron-builder from the environment and are never logged or written to disk.
const { existsSync } = require("node:fs");
const path = require("node:path");
const { signingPlan, describePlan } = require("./scripts/signing-plan.cjs");

function buildConfig(env = process.env) {
  const plan = signingPlan(env);

  // Unsigned path: identity "-" forces an ad-hoc signature and skips keychain
  // auto-discovery, so a Developer ID in the developer's keychain is never picked up
  // unless they opt in. `notarize: false` matters here: electron-builder otherwise
  // notarizes whenever APPLE_* variables are present, even after an ad-hoc signature.
  //
  // Signed path: `identity` is omitted so electron-builder resolves it from CSC_NAME,
  // or from the temporary keychain it builds out of CSC_LINK. `notarize` is a boolean
  // in electron-builder 26; the credentials themselves are read from APPLE_ID,
  // APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID. Without all three we set it false,
  // because a partial set would otherwise make electron-builder throw mid-build.
  //
  // Native binaries under Contents/Resources/host/node_modules (.node and .dylib
  // files of native modules) need no `binaries` list: @electron/osx-sign walks all of
  // Contents and signs every binary file it finds, deepest first, with the same
  // identity and hardened runtime. That includes the linux/win32 prebuilds and wasm
  // modules in the tree. codesign accepted them with an ad-hoc identity; that has not
  // been checked with a Developer ID identity or by the notary service, so if a signed
  // build fails on them, add `signIgnore` patterns for the foreign-platform directories.
  const mac = plan.sign
    ? {
        hardenedRuntime: true,
        // Without this, a missing certificate only logs a warning and ships an unsigned app.
        forceCodeSigning: true,
        gatekeeperAssess: false,
        entitlements: path.join(__dirname, "build-resources", "entitlements.mac.plist"),
        entitlementsInherit: path.join(__dirname, "build-resources", "entitlements.mac.plist"),
        notarize: plan.notarize,
      }
    : { identity: "-", hardenedRuntime: false, notarize: false };

  return {
    appId: "app.pista.desktop",
    productName: "Pista",
    copyright: "Copyright © 2026 Pista contributors",
    directories: { output: "release" },
    files: ["dist/**/*", "package.json"],
    // build/llama exists only when scripts/fetch-llama.mjs staged it (macOS arm64, not opted out). It is signed with the
    // app: @electron/osx-sign signs every binary under Contents/, so llama-server and its dylibs need no `binaries` entry.
    extraResources: [
      { from: "build/ui", to: "ui" },
      ...(existsSync(path.join(__dirname, "build", "llama")) ? [{ from: "build/llama", to: "llama" }] : []),
    ],
    asar: true,
    npmRebuild: false,
    mac: { category: "public.app-category.developer-tools", target: ["dir"], ...mac },
    dmg: { title: "Pista", ...(plan.sign ? { sign: true } : {}) },
    afterPack: "scripts/after-pack.cjs",
  };
}

const config = buildConfig();
const summary = describePlan(signingPlan(process.env));
// Signing on without notarization is almost never intended for a release: make it loud.
(summary.startsWith("WARNING:") ? console.warn : console.log)(summary);

// electron-builder validates the exported object against its schema, so export only config.
module.exports = config;
