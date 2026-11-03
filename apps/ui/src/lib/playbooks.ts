import { describeStep, type PlaybookStep } from "@pista/protocol";

export { describeStep };


/** Lines for the optional row/period selectors that may accompany a step; they come before the step itself. */
function describeExtras(step: PlaybookStep): string[] {
  const t = "target" in step ? step.target : undefined;
  const out: string[] = [];
  if (step.kind !== "click" && t?.row) out.push("Pick the row matching the invoice date");
  return out;
}

export function describeSteps(steps: PlaybookStep[]): string[] {
  return steps.flatMap((s) => [...describeExtras(s), describeStep(s)]);
}
