/**
 * Smoke test for the standalone path: loads the extension through a stub pi API and drives
 * a Chromium started with --remote-debugging-port (PI_BROWSER_CDP_URL, default :9222).
 *   python3 -m http.server 8765 --bind 127.0.0.1 -d test/fixture
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/pi-browser-test
 *   npx tsx test/smoke-cdp.ts
 */
import extension from "../src/standalone.ts";

type Tool = { name: string; execute: (id: string, params: any) => Promise<{ content: { type: string; text?: string }[] }> };
const tools = new Map<string, Tool>();
extension({ registerTool: (tool: Tool) => tools.set(tool.name, tool) } as any);
console.log("registered:", [...tools.keys()].join(", "));

const call = async (name: string, params: object = {}) => {
  const res = await tools.get(name)!.execute("t", params);
  const [meta, body] = res.content.map((c) => c.text ?? `[${c.type}]`);
  console.log(`\n>>> ${name} ${JSON.stringify(params)}\n${meta}${body ? `\n${body.split("\n").slice(0, 16).join("\n")}` : ""}`);
  return body ?? "";
};
const ref = (text: string, pattern: RegExp) => text.match(pattern)?.[1] ?? "missing";

const fixture = process.env.PI_BROWSER_FIXTURE ?? "http://127.0.0.1:8765/";
await call("browser_navigate", { url: fixture });
const snap = await call("browser_snapshot");
await call("browser_click", { ref: ref(snap, /\[(e\d+)\] button "Check trust"/) });
await call("browser_type", { ref: ref(snap, /\[(e\d+)\] textbox "To"/), text: "Lisbon" });
await call("browser_select", { ref: ref(snap, /\[(e\d+)\] combobox/), option: "business" });
await call("browser_click", { ref: ref(snap, /\[(e\d+)\] textbox "Key log"/) });
await call("browser_press", { key: "ArrowDown" });
const last = await call("browser_type", { ref: ref(snap, /\[(e\d+)\] textbox "From"/), text: "Stockholm", submit: true });
await call("browser_read", { maxChars: 200 });
await call("browser_back");
const shot = await tools.get("browser_screenshot")!.execute("t", {});
console.log("\nscreenshot parts:", shot.content.map((c) => c.type).join(", "));
process.exit(0);
