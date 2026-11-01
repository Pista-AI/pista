# Release signing and packaging

How Pista's desktop builds are packaged, signed and released. Signing is opt-in everywhere and driven by environment variables; nothing is prompted for and nothing is written to the repo or to files. macOS builds are signed with a Developer ID certificate and notarized; Windows builds are signed with a certificate or Azure Trusted Signing. Linux packages are not signed. The CI release flow that ties these together is described under [CI release](#ci-release).

## macOS

`pnpm package:desktop` (and `package:dmg`) builds `Pista.app`. By default it is **ad-hoc signed**, which is fine on the machine that built it and nowhere else. To produce a build that other Macs open without Gatekeeper warnings, sign it with a Developer ID Application certificate and notarize it. Everything is driven by environment variables; nothing is prompted for and nothing is written to the repo or to files.

The logic lives in `apps/desktop/electron-builder.config.cjs` (config) and `apps/desktop/scripts/signing-plan.cjs` (decision). The build prints one line at start, either `Signing: off (...)` or `Signing: on, notarization: on|off (missing ...)`. Secret values are never logged.

### Environment variables

| Variable | Purpose |
|---|---|
| `CSC_LINK` | The Developer ID Application certificate as a base64-encoded `.p12`, or a path / `https://` URL to one. Setting it turns signing on. |
| `CSC_KEY_PASSWORD` | Password of that `.p12`. Goes with `CSC_LINK`. |
| `CSC_NAME` | Alternative to `CSC_LINK`: the name of a certificate already in your login keychain, without the `Developer ID Application:` prefix (for example `Acme Inc (ABCDE12345)`). Setting it turns signing on. |
| `APPLE_ID` | Apple ID email used for notarization. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID (appleid.apple.com, Sign-In and Security). Not your account password. |
| `APPLE_TEAM_ID` | Ten-character team ID (developer.apple.com, Membership). |

#### Packaging inputs (not secrets)

| Variable | Purpose |
|---|---|
| `PISTA_BUNDLE_LLAMA` | Set to `0` to skip staging llama-server into the app (see [desktop-llama-bundling.md](desktop-llama-bundling.md)). Default: bundled on macOS arm64, skipped elsewhere. |
| `PISTA_LLAMA_BUNDLE_DIR` | Read by the host, set by the desktop shell to `Pista.app/Contents/Resources/llama` when that exists. You do not set it for packaged builds. |

### What happens when each is unset

- None of `CSC_LINK` / `CSC_NAME`: unsigned path. Ad-hoc signature, no hardened runtime, no notarization, even if `APPLE_*` are set and even if a Developer ID certificate sits in your keychain. This is today's local build.
- `CSC_LINK` or `CSC_NAME` set: Developer ID signature with hardened runtime and the entitlements in `apps/desktop/build-resources/entitlements.mac.plist`. If the certificate cannot be found or imported, the build fails (`forceCodeSigning` is on) rather than shipping an unsigned app.
- Signing on and all three `APPLE_*` set: the signed app is also notarized (`notarytool`, waits for Apple, about a few minutes). The ticket is stapled to the `.app` by electron-builder.
- Signing on but any `APPLE_*` missing: signed but not notarized. The build prints a `WARNING:` line (via `console.warn`) naming the missing variables.

Only the Apple ID path is wired. The App Store Connect API key and keychain-profile alternatives are not used by this config.

### Exporting the certificate

1. In Xcode (Settings, Accounts, Manage Certificates) or at developer.apple.com, create a **Developer ID Application** certificate.
2. In Keychain Access, find it under My Certificates, expand it so the private key is included, right-click and choose Export. Save as `.p12` and set a password.
3. Base64-encode it for CI secrets: `base64 -i DeveloperID.p12 | pbcopy`. Store the result as `CSC_LINK` and the password as `CSC_KEY_PASSWORD` in your CI secret store.
4. Delete the `.p12` from disk once it is stored.

### Local signed build

Export the variables in your shell for that one command, never in a file in the repo:

```bash
CSC_NAME="Acme Inc (ABCDE12345)" \
APPLE_ID=you@example.com APPLE_APP_SPECIFIC_PASSWORD=... APPLE_TEAM_ID=ABCDE12345 \
pnpm package:dmg
```

In CI, map the secrets to the same variable names.

### Verifying a signed build

```bash
APP=apps/desktop/release/mac-arm64/Pista.app
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dv --verbose=4 "$APP" 2>&1 | grep -E "Authority|TeamIdentifier|flags"   # expect flags=...(runtime)
spctl -a -vv -t exec "$APP"            # expect: accepted, source=Notarized Developer ID
xcrun stapler validate "$APP"          # expect: The validate action worked!
```

`spctl` reports `Developer ID` rather than `Notarized Developer ID` when notarization was off.

For a `.dmg` (`package:dmg`), the signed path sets `dmg.sign: true`, so the image gets a Developer ID signature from the same identity as the app (app-builder-lib's DMG signer looks up a Developer ID Application certificate using the same `identity` setting). electron-builder notarizes and staples only the `.app` inside it, not the image. Gatekeeper checks the stapled `.app` when the user opens it from the dmg. Verify the image with:

```bash
codesign --verify --verbose=2 apps/desktop/release/Pista-*.dmg
```

`xcrun stapler validate` on the dmg is expected to fail because the image carries no ticket; that is not a problem.

### Pull-request builds are never signed

electron-builder skips code signing entirely when its CI detection sees a pull-request build, even if `CSC_LINK` is set (`isSignAllowed` in app-builder-lib's `macCodeSign`), unless `CSC_FOR_PULL_REQUEST=true`. `forceCodeSigning` does not catch this path, so such a build is quietly ad-hoc signed or unsigned. Our release workflow (`release.yml`) runs on tag pushes and manual dispatch, so it is unaffected, but a PR build will never be signed. Do not set `CSC_FOR_PULL_REQUEST` for untrusted forks: it would expose the signing secrets to them.

### Why the config looks the way it does

- Native binaries under `Contents/Resources/host/node_modules` (`.node` and `.dylib` files of native modules) need no `mac.binaries` list. `@electron/osx-sign` walks all of `Contents/` and signs every binary file it finds, deepest first, with the same identity and hardened runtime. Because they share one signing identity, library validation should pass, so `com.apple.security.cs.disable-library-validation` is not requested. The tree also holds linux/win32 prebuilds and wasm modules, which the walk will try to sign too. `codesign` accepted them when tried with an ad-hoc identity; that was not checked with a Developer ID identity or by the notary service. If a signed build fails on them, add `signIgnore` patterns for the foreign-platform directories.
- The bundled llama-server and its dylibs (`Contents/Resources/llama/<tag>/`) are signed the same way, with no extra config. An ad-hoc hardened-runtime build of that directory fails to load its own dylibs (ad-hoc signatures have no Team ID, so library validation rejects them); with one real Team ID on every file it loads, so keep them signed by the same identity.
- The entitlements are `allow-jit` and `allow-unsigned-executable-memory`, which V8 needs. The agent host runs inside the same Electron executable as a utility process, so it uses them too. The `RunAsNode` fuse is off (with the Node options and CLI inspect fuses), so the executable cannot be used as a plain Node interpreter.
- On the unsigned path `notarize` is forced to `false`, because electron-builder otherwise notarizes whenever `APPLE_*` variables are present.

### What cannot be checked without real credentials

Certificate import, the actual signature on nested binaries under hardened runtime, notarization acceptance, stapling, and first launch of the signed app (host spawns, native modules load). Do a full verification pass the first time you sign. The release checklist for that first real Developer ID build includes running `codesign --verify --deep --strict` on `Pista.app` and loading a Metal model through the bundled llama-server (this exercises the nested dylibs in `Resources/llama` under hardened runtime).

## Windows

`pnpm --filter @pista/desktop package:win` builds an NSIS installer (`Pista-Setup-<version>-x64.exe`) into `apps/desktop/release`; run it on Windows. `package:linux` builds an AppImage and a deb on Linux. In CI both are built by `.github/workflows/desktop-package.yml` (see [CI release](#ci-release)). Windows signing is off unless one of these is set; unsigned builds succeed (SmartScreen will warn).

| Method | Variables |
|---|---|
| Certificate (PFX) | `WIN_CSC_LINK` (path, URL or base64 of the .pfx), `WIN_CSC_KEY_PASSWORD`. Read by electron-builder; the macOS `CSC_LINK` is never used for Windows. |
| Azure Trusted Signing | `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT`, `AZURE_TRUSTED_SIGNING_PROFILE`, `AZURE_TRUSTED_SIGNING_PUBLISHER`, plus `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`. A partial set fails the build. |

When signing is configured, electron-builder fails the build if it cannot sign (`forceCodeSigning`). Map the values as repository secrets of the same names; the workflow passes them to the Windows packaging step only on tags (same-repo pull requests receive repository secrets, so PR builds are deliberately unsigned). A tag fails when no Windows signing is configured unless the repository variable `ALLOW_UNSIGNED_RELEASE=1` is set, as for macOS. Not verified without real credentials: the signature itself, SmartScreen reputation, and the Azure path (written from electron-builder's `azureSignOptions` docs).

## CI release

Two workflows are involved.

- `.github/workflows/desktop-package.yml` builds the Windows installer (artifact `pista-windows-x64`, with `latest.yml` and the blockmap) and the Linux AppImage and deb (artifact `pista-linux-x64`). It runs on pull requests that touch `apps/desktop`, `apps/host` or the two workflow files, and is called from `release.yml`. It only uploads workflow artifacts and never creates a release.
- `.github/workflows/release.yml` runs on a `v*` tag and on manual dispatch (Actions tab, Release, Run workflow). It has three jobs:
  1. `package-mac` runs on `macos-15` (Apple silicon), typechecks, packages the dmg, verifies the signature, and uploads the dmg, the update zip, their blockmaps and the channel yml (`latest-mac.yml`, or `beta-mac.yml` / `rc-mac.yml` for a prerelease version) as the artifact `pista-mac-arm64`. The job summary says whether the build is signed and notarized; an unsigned build is marked not suitable for auto-update.
  2. `package-other` calls `desktop-package.yml` for Windows and Linux.
  3. `release` runs only on a tag, after both packaging jobs. It downloads every `pista-*` artifact and uploads all of them to **one draft** GitHub release. A single job owns the release so the packaging jobs cannot create duplicate drafts; re-running the workflow for the same tag updates the draft.

The macOS job is intentionally not in `ci.yml`.

### Secrets and gates

Configure these under Settings, Secrets and variables, Actions, as repository secrets (the variable names are the ones described above).

| Secret | Value |
|---|---|
| `CSC_LINK` | Base64 of the Developer ID Application `.p12` |
| `CSC_KEY_PASSWORD` | Password of that `.p12` |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | Ten-character team ID |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows PFX certificate (see [Windows](#windows)) |
| `AZURE_*` | Azure Trusted Signing values (see [Windows](#windows)) |

- **macOS**: the three `APPLE_*` secrets must be all set or all unset; a partial set fails the "Check signing inputs" step. Notarization also needs `CSC_LINK`. The macOS job receives its secrets on tags and on manual dispatch; a manual run can untick the `notarize` input (default on) to sign without notarizing, which is faster.
- **Windows and Linux**: the Windows signing secrets are passed to the packaging step only on tags (`github.ref_type == 'tag'`), because same-repo pull requests receive repository secrets and PR builds are deliberately unsigned. A manual dispatch therefore builds an unsigned Windows installer.
- **Unsigned tags**: on a tag, each of the macOS and Windows jobs fails when its signing is not configured (`CSC_LINK`, or `WIN_CSC_LINK` / the Azure secrets) unless the repository **variable** (not secret) `ALLOW_UNSIGNED_RELEASE` is set to `1`, which lets the tag publish an unsigned build. Linux has no signing gate.
- With no secrets configured, a manual dispatch produces unsigned builds, so the pipeline can be tried on a fork. Fork pull requests never receive the secrets and `release.yml` does not run on pull requests. Anyone with write access to the repository can dispatch `release.yml` and thereby receive the macOS signing secrets, so consider moving them into a protected environment with required reviewers.

### Cut a release

```bash
git tag v0.x.y && git push origin v0.x.y
```

When the run is green, open the draft release under Releases and check the notes and assets: the macOS dmg and zip with `latest-mac.yml`, the Windows installer with `latest.yml`, and the Linux AppImage and deb, plus the blockmaps. Then publish it. Publishing is what exposes the build to the auto-updater, which only sees published releases (publish beta versions as prereleases). Manual dispatch builds from the selected branch and uploads workflow artifacts only; it creates no release.

## Auto-update and feeds

**Version and channel rule.** On a tag the version is taken from the tag (`v0.3.0-rc.1` builds `0.3.0-rc.1`), not from `apps/desktop/package.json`; a tag that is not `vMAJOR.MINOR.PATCH` with an optional `-prerelease` fails the build. The workflows pass it as `PISTA_BUILD_VERSION`, which `scripts/package.mjs` hands to electron-builder, so the artifact names, `app.getVersion()` (and the `PISTA_APP_VERSION` the host version gate uses), `app-update.yml` and the feed yml all carry it. Builds that are not tag builds keep the `package.json` version. With the GitHub publish provider electron-builder 26 writes only `latest*.yml`, even for a prerelease version (measured with `0.0.0-rc.9`: `latest-mac.yml`). `apps/desktop/scripts/package.mjs` therefore also copies each `latest*.yml` to `<channel>*.yml` for a prerelease version, where the channel is the first prerelease identifier: `-beta.N` gives `beta-mac.yml`, `-rc.N` gives `rc-mac.yml`, `-alpha.N` gives `alpha-mac.yml` (Windows `beta.yml`, Linux `beta-linux.yml`, and so on). Stable versions write `latest*.yml` only. The release job uploads whichever ymls were produced. A tag containing `-` creates a GitHub **prerelease** (still a draft until published). The managed policy `updates.channel` offers only `stable` and `beta`.

The desktop auto-updater (see [Updates](ENTERPRISE.md#updates)) only works with the signed and notarized build: on macOS, Squirrel.Mac refuses to apply an update to or from an unsigned app. Unsigned builds download nothing useful, so run them with updates off.

### Mirroring to a company server

To host updates internally, run `node scripts/mirror-release.mjs <tag> <dir>` after publishing, upload `<dir>` to an HTTPS location and set `updates.feedUrl` to it in the managed policy. Layout and channels are described under [Release feed and company-hosted mirror](ENTERPRISE.md#release-feed-and-company-hosted-mirror). The mirrored files are the signed originals, so the server needs no keys. Not verified end to end without Apple credentials.
