import { describeStep, hostPath, type PlaybookStep } from "@pista/protocol";

/** Lines for the optional row/period selectors that may accompany a step; they come before the step itself. */
function describeExtras(step: PlaybookStep): string[] {
  const t = "target" in step ? step.target : undefined;
  const out: string[] = [];
  if (step.kind !== "click" && t?.row) out.push("Pick the row matching the invoice date");
  return out;
}

/** Where a playbook starts, and where it opens the list directly when it knows how: host and path only, never the query. Text, never a link. */
export function describeStart(startUrl: string, shortcutUrl?: string): string[] {
  return [`Starts at ${hostPath(startUrl)}`, ...(shortcutUrl ? [`Opens the list directly at ${hostPath(shortcutUrl)}`] : [])];
}

export function describeSteps(steps: PlaybookStep[]): string[] {
  return steps.flatMap((s) => [...describeExtras(s), describeStep(s)]);
}
