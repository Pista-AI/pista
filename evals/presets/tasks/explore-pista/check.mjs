// Hidden check: ANSWER.md must name the real identifiers on the approval round trip, as whole words, in path order.
import { readFileSync } from "node:fs";
let text = "";
try { text = readFileSync("ANSWER.md", "utf8"); } catch { console.error("no ANSWER.md"); process.exit(1); }
const first = (id) => text.match(new RegExp(`(?<![\\w])${id.replace(/\./g, "\\.")}(?![\\w])`))?.index ?? -1;
const required = ["approvalExtension", "approval.request", "ApprovalCard", "respondApproval", "approval.respond", "settle"];
const extra = ["tool_call", "hub.ask", "onHostEvent", "approval.resolved"];
const missing = required.filter((id) => first(id) < 0);
const extraHit = extra.filter((id) => first(id) >= 0);
console.log(`required ${required.length - missing.length}/${required.length}, extra ${extraHit.length}/${extra.length}: ${extraHit.join(", ")}`);
const fails = [];
if (missing.length) fails.push("missing: " + missing.join(", "));
if (extraHit.length < 3) fails.push("need at least 3 of: " + extra.join(", "));
if (!missing.length) {
  const host = Math.min(first("approvalExtension"), first("approval.request"));
  const card = first("ApprovalCard");
  const back = Math.min(first("respondApproval"), first("approval.respond"), first("settle"));
  if (!(host < card && card < back)) fails.push("order: host request, then UI card, then respond/settle steps");
}
if (fails.length) { console.error(fails.join("\n")); process.exit(1); }
