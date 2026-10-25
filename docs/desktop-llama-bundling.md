# Bundling llama-server in the desktop app

Status: decided. Scope: packaged macOS arm64 builds.

## Options considered

- **A. Download only, at first use.** What shipped first. The host fetches the pinned llama.cpp release into `$PISTA_HOME/llama/bin/<tag>/`.
- **B. Bundle in Resources, download as fallback.**
- **C. Bundle only.**

## Decision

**B** for macOS arm64 packaged builds. Other platforms and headless/server mode stay download-only for now.

## Why

- First run works offline and without a 12 MB download.
- The binary is covered by the app's Developer ID signature and notarization. Today's download path works only because Node's fetch does not set the quarantine xattr, which is fragile, and the unpacked binary is ad-hoc ("linker-signed"): it runs when spawned by a notarized app, but sits outside the app's trust boundary.
- Integrity is checked once, at package time (size and sha256 of the pinned tarball), instead of at every install.
- Updates still flow through the download path: the host uses the bundle only when its tag equals the host's pinned tag (`apps/host/src/llama-build.json`), otherwise it downloads. A stale bundle is harmless.
- C was rejected because headless/server deployments and other platforms have no app bundle, and the host must not assume Electron.

Costs: the app grows by about 31 MB staged (about 28 MB inside the .app; llama-server plus the dylibs it references, the other CLI tools in the release are dropped), packaging needs network once (the tarball is cached in `apps/desktop/.cache/llama`), and the bundle can lag the host pin.

## How it fits together

- One source of truth: `apps/host/src/llama-build.json` (tag, url, size, sha256). The host imports it as `LLAMA_BUILDS`; `apps/desktop/scripts/fetch-llama.mjs` reads the same file.
- `fetch-llama.mjs` (called from `package.mjs`) stages `apps/desktop/build/llama/<tag>/` with `llama-server` and its dylibs side by side, because they find each other through `@rpath`. The dylib set is derived with `otool -L`; each is staged as a real file under its referenced name (`libfoo.0.dylib`), so there are no symlinks, and the script fails if any `@rpath` reference is unresolved. Metal shaders are embedded in `libggml-metal`; there is no `.metallib`. `PISTA_BUNDLE_LLAMA=0` or a non-darwin-arm64 machine skips it.
- `electron-builder.config.cjs` adds `build/llama` to `extraResources` only when it exists.
- The desktop main process sets `PISTA_LLAMA_BUNDLE_DIR=<Resources>/llama` for the host when packaged and the folder exists. The host learns about the bundle only through that variable.
- `LlamaRuntime` prefers `<bundleDir>/<tag>/llama-server`, reports `source: "bundled" | "downloaded"` in its status, never downloads when bundled, and `remove()` never touches the bundle.

## Signing

electron-builder's osx-sign walks every binary under `Contents/` and signs it with the app identity and hardened runtime (checked in `@electron/osx-sign` 1.3.3), so no `mac.binaries` list is needed. All files must carry the same Team ID: with hardened runtime and library validation, dylibs signed by a different identity, or ad-hoc, are refused at load time.

## Not verified

- A real Developer ID signed and notarized build, including osx-sign signing of the nested files in `Resources/llama`. The first real Developer ID build must run `codesign --verify --deep --strict` on `Pista.app` and then load a Metal model through the bundled llama-server. See [release-signing.md](release-signing.md).
- A Metal model load from the bundled binary (only `--version` was run).
