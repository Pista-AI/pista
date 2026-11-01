// Hidden check: ANSWER.md must name most of the real hops of the approval round trip.
import { readFileSync } from "node:fs";
let text = "";
try { text = readFileSync("ANSWER.md", "utf8"); } catch { console.error("no ANSWER.md"); process.exit(1); }
const hops = ["extensions.ts", "approvalExtension", "approval.request", "hub.ts", "Transcript.tsx", "ApprovalCard", "store.ts", "respondApproval", "approval.respond", "settle"];
const hit = hops.filter((h) => text.includes(h));
console.log(`hops named ${hit.length}/${hops.length}: ${hit.join(", ")}`);
if (hit.length < 8) { console.error("missing: " + hops.filter((h) => !hit.includes(h)).join(", ")); process.exit(1); }
