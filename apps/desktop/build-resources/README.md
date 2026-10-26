# Build resources

Files electron-builder reads while packaging (`directories.buildResources` in `electron-builder.config.cjs`). This is not `apps/desktop/build/`: that folder is generated, gitignored staging for the UI and llama.cpp.

| File | Used for |
| --- | --- |
| `icon.icns` | macOS app icon (`mac.icon`) |
| `icon.ico` | Windows app, NSIS installer and MSI icon (`win.icon`), sizes 16 to 256 |
| `icons/<n>x<n>.png` | Linux AppImage and deb icons (`linux.icon`) |
| `icon.png` | 1024x1024 master |
| `entitlements.mac.plist` | macOS hardened-runtime entitlements |

The current icons are placeholders: a pistachio (`#93C572`) rounded square with a white "P", the same artwork as `apps/ui/public/pista.svg`.

## Swapping in real artwork

1. Export a square 1024x1024, 8-bit RGBA (or RGB), non-interlaced PNG and save it as `build-resources/icon.png`. Leave a transparent margin if you want rounded corners; macOS does not round them for you.
2. From `apps/desktop`, run `node scripts/make-icons.mjs --from-png`. It downscales the master into `icon.icns`, `icon.ico` and every Linux size. It needs only Node, no extra packages.
3. Update `apps/ui/public/pista.svg` (the favicon) to match, and commit the regenerated files.

Running `node scripts/make-icons.mjs` with no flag redraws the placeholder instead and overwrites `icon.png`.

Check a mac build with `PISTA_BUNDLE_LLAMA=0 pnpm package:desktop`: `Pista.app/Contents/Info.plist` should name `icon.icns` in `CFBundleIconFile` and `Contents/Resources/icon.icns` should exist.
