/**
 * Entry point when loaded as a plain pi package (outside the desktop app) (`"pi": { "extensions": [...] }`):
 * drives a Chromium-based browser over CDP. Start one with e.g.
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir=/tmp/pi-browser
 * and point elsewhere with PI_BROWSER_CDP_URL.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CdpDriver } from "./drivers/cdp.ts";
import { registerBrowserTools } from "./tools.ts";

export default function (pi: ExtensionAPI) {
  const driver = new CdpDriver(process.env.PI_BROWSER_CDP_URL ?? "http://127.0.0.1:9222");
  registerBrowserTools(pi, () => driver);
}
