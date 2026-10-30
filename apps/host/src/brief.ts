/** Structure of the `agent` tool's brief and of the report a sub-agent returns. Pure helpers, no I/O. */

export interface BriefFields {
  goal: string;
  pointers?: string[];
  acceptance?: string;
  constraints?: string;
}

export const CODE_IN_BRIEF_ERROR =
  "Briefs carry the goal, pointers and acceptance; the sub-agent reads the code and writes the implementation. Remove the code and describe the outcome instead.";

const STANDING_LINE =
  "Read the code before deciding details; follow the conventions of neighbouring code; if the request is ambiguous, pick the conventional reading and state the assumption in your report.";

const CODE_LINE = /(?:[;{}]$)|^(?:import|export|const|function|return)\s/;

/** True when the text has a fenced code block or more than 2 lines that look like code. */
export function looksLikeCode(text: string | undefined): boolean {
  if (!text) return false;
  if (/```/.test(text)) return true;
  const codeLines = text.split("\n").filter((line) => CODE_LINE.test(line.trim()));
  return codeLines.length > 2;
}

/** Returns the error message when the brief carries implementation, otherwise undefined. */
export function briefProblem(fields: Pick<BriefFields, "goal" | "constraints">): string | undefined {
  return looksLikeCode(fields.goal) || looksLikeCode(fields.constraints) ? CODE_IN_BRIEF_ERROR : undefined;
}

/** The child's first user message. A follow-up (`continueId`) carries the goal as the message and skips the standing line. */
export function composeBrief(fields: BriefFields, followUp = false): string {
  const parts = [followUp ? fields.goal.trim() : `## Goal\n${fields.goal.trim()}`];
  const pointers = (fields.pointers ?? []).map((p) => p.trim()).filter(Boolean);
  if (pointers.length) parts.push(`## Start from\n${pointers.map((p) => `- ${p}`).join("\n")}`);
  if (fields.acceptance?.trim()) parts.push(`## Acceptance\n${fields.acceptance.trim()}`);
  if (fields.constraints?.trim()) parts.push(`## Constraints\n${fields.constraints.trim()}`);
  if (!followUp) parts.push(STANDING_LINE);
  return parts.join("\n\n");
}

/** Read-only roles report `## Findings`; the others report `## Changed`. */
export function reportSections(role: string | undefined): string[] {
  return [role === "explorer" || role === "reviewer" ? "## Findings" : "## Changed", "## Ran", "## Assumptions", "## Open questions"];
}

/** Text added to a role prompt so the child ends with the expected report. */
export function reportFormatPrompt(role: string): string {
  const changed = reportSections(role)[0] === "## Changed";
  return `Your final message must have these sections, in order: ${reportSections(role).join(", ")}. ${
    changed ? 'Under ## Changed list the files, one line each, or write "none".' : "Under ## Findings put what you found, with file paths."
  } Under ## Ran list commands and their results.`;
}

/** True when every required section heading appears on a line of its own. */
export function hasReportSections(text: string, role: string | undefined): boolean {
  return reportSections(role).every((heading) => new RegExp(`^${heading}\\s*$`, "mi").test(text));
}

export function reportFollowUp(role: string | undefined): string {
  return `Your last message is not in the required report format. Reply with the report only, with these sections: ${reportSections(role).join(", ")}. Use "none" for an empty section.`;
}

export const MAX_REPORT_CHARS = 6000;

/** Caps the report returned to the parent, marking the cut. */
export function capReport(text: string, max = MAX_REPORT_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[truncated]`;
}
