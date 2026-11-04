import { describeStep, hostPath, type MerchantRefusal, type PlaybookStep } from "@pista/protocol";

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

const REFUSALS: Record<MerchantRefusal, string> = {
  "too-short": "is too short. Add a word that names the vendor.",
  "too-long": "is too long. Use the vendor's name only.",
  "wildcard-placement": "has a * in the wrong place. Put it between two words.",
  "too-many-wildcards": "has too many *. Use at most two.",
  "too-general": "is too general. Add a word that names the vendor.",
  "too-many": "does not fit. Remove a keyword first.",
};

/** The host's reason a typed keyword was refused, in plain words. */
export function describeRefusal(keyword: string, reason: MerchantRefusal): string {
  return `"${keyword}" ${REFUSALS[reason] ?? "was not accepted."}`;
}

const WHY: Record<string, string> = {
  short: "Short keyword: it could match other vendors.",
  umbrella: "Names a company that sells many things.",
  "other-site": "Already used for another site.",
  unsure: "The model was not sure it is specific.",
};

/** Why a learned keyword waits for the user, in plain words. */
export function describePendingWhy(why: string | undefined): string | undefined {
  return why ? WHY[why] : undefined;
}
