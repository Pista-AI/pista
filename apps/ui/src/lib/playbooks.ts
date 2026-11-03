import type { PlaybookLocator, PlaybookStep } from "@pista/protocol";

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search || "/";
  } catch {
    return url;
  }
}

function locatorLabel(t?: PlaybookLocator): string {
  return t?.name || t?.text || t?.selector || t?.role || "element";
}

/** One plain, readable line for a playbook step. Playbooks are untrusted: the result is rendered as text only. */
export function describeStep(step: PlaybookStep): string {
  switch (step.kind) {
    case "navigate":
      return `Open ${pathOf(step.url)}`;
    case "signIn":
      return "Sign in with saved login";
    case "click": {
      const noun = step.target?.role === "link" ? " link" : step.target?.role === "button" ? " button" : "";
      return `Click${noun} '${locatorLabel(step.target)}'`;
    }
    case "wait":
      return step.expect?.text ? `Wait for '${step.expect.text}'` : step.expect?.urlIncludes ? `Wait for page '${step.expect.urlIncludes}'` : "Wait for the page";
    case "download":
      return `Download${step.fileType ? ` (${step.fileType.toUpperCase()})` : ""}`;
    default:
      return `Step: ${String((step as { kind?: unknown }).kind)}`;
  }
}

/** Lines for the optional row/period selectors that may accompany a step; they come before the step itself. */
function describeExtras(step: PlaybookStep): string[] {
  const s = step as { row?: unknown; period?: unknown };
  const out: string[] = [];
  if (s.period) out.push("Pick the invoice's month");
  if (s.row) out.push("Pick the row matching the invoice date");
  return out;
}

export function describeSteps(steps: PlaybookStep[]): string[] {
  return steps.flatMap((s) => [...describeExtras(s), describeStep(s)]);
}
