// Prints snapshots of a few pages through CDP: npx tsx test/snapshot-text.ts <url>...
import { CdpDriver, runPageAction } from "../src/index.ts";

const d = new CdpDriver(process.env.PI_BROWSER_CDP_URL);
for (const url of process.argv.slice(2)) {
  await d.navigate(url);
  const text = (await runPageAction(d, { action: "snapshot" })).text ?? "";
  console.log(`\n=== ${url} (${text.length} chars)\n${text.split("\n").slice(0, 32).join("\n")}`);
}
process.exit(0);
