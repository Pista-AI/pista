// electron-builder configuration, computed from the environment at load time.
//
// Signing is opt-in. With no credentials in the environment the build is ad-hoc
// signed exactly as before (local use only). Set CSC_LINK or CSC_NAME to produce a
// Developer ID signed, hardened-runtime build; add the three APPLE_* variables to
// also notarize it. See docs/release-signing.md. Secrets are read only by
// electron-builder from the environment and are never logged or written to disk.
const { existsSync } = require("node:fs");
const path = require("node:path");
const { signingPlan, describePlan, winSigningPlan } = require("./scripts/signing-plan.cjs");

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

  // Windows signing is opt-in too; unsigned builds succeed. WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD are read by
  // electron-builder itself, so the shared CSC_* (macOS) variables are never used for Windows.
  const win = winSigningPlan(env);
  if (win.method === "azure" && win.missing.length > 0) {
    throw new Error(`Azure Trusted Signing is partly configured; also set ${win.missing.join(", ")}`);
  }

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
    mac: { category: "public.app-category.developer-tools", target: ["dir", "zip"], ...mac },
    dmg: { title: "Pista", ...(plan.sign ? { sign: true } : {}) },
    win: {
      // MSI is not built: electron-builder's WiX template fails without an application icon (LGHT0094 Icon:PistaIcon.exe)
      // and the repo has none yet. Add build-resources/icon.ico and re-add { target: "msi", arch: ["x64"] } then.
      target: [{ target: "nsis", arch: ["x64"] }],
      ...(win.method === "pfx" ? { forceCodeSigning: true } : {}),
      ...(win.method === "azure"
        ? {
            forceCodeSigning: true,
            azureSignOptions: {
              endpoint: env.AZURE_TRUSTED_SIGNING_ENDPOINT,
              codeSigningAccountName: env.AZURE_TRUSTED_SIGNING_ACCOUNT,
              certificateProfileName: env.AZURE_TRUSTED_SIGNING_PROFILE,
              publisherName: env.AZURE_TRUSTED_SIGNING_PUBLISHER,
            },
          }
        : {}),
    },
    // oneClick off shows the per-user / per-machine choice; /S /allusers installs silently for all users.
    nsis: { oneClick: false, perMachine: false, allowElevation: true, allowToChangeInstallationDirectory: true, artifactName: "Pista-Setup-${version}-${arch}.${ext}" },
    linux: { executableName: "pista", category: "Development", maintainer: "Pista <noreply@pista.app>", target: ["AppImage", "deb"], artifactName: "Pista-${version}-${arch}.${ext}" },
    afterPack: "scripts/after-pack.cjs",
    // Generates latest-mac.yml (beta-mac.yml when the version has a "-beta.N" prerelease tag; electron-builder
    // derives the channel from it) and app-update.yml, the default feed baked into the app. The package script runs
    // electron-builder with --publish never, so nothing is uploaded here: release.yml attaches the files to the draft
    // GitHub release. updates.feedUrl in the managed policy overrides this feed (docs/ENTERPRISE.md).
    publish: [{ provider: "github", owner: process.env.PISTA_UPDATE_OWNER || "Pista-AI", repo: process.env.PISTA_UPDATE_REPO || "pista", releaseType: "release" }],
  };
}

const config = buildConfig();
const summary = describePlan(signingPlan(process.env));
// Signing on without notarization is almost never intended for a release: make it loud.
(summary.startsWith("WARNING:") ? console.warn : console.log)(summary);

// electron-builder validates the exported object against its schema, so export only config.
module.exports = config;
